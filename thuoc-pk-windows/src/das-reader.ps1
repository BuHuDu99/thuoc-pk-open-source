param([string]$ConfigPath, [switch]$Inspect, [ValidateSet('auto', 'uia', 'msaa')][string]$ReaderMode = 'auto')
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
# Startup failures use fixed codes only; never send exception text or records.
# Do not compile C# on Windows 7: load the shipped CLR 2 / AnyCPU helper.
try {
    Add-Type -AssemblyName System.Web.Extensions
    $serializer = New-Object System.Web.Script.Serialization.JavaScriptSerializer
    $serializer.MaxJsonLength = 524288
} catch {
    [Console]::WriteLine('{"status":"reader-error","reason":"runtime-unavailable"}')
    exit 1
}
function Emit($value) {
    [Console]::WriteLine($serializer.Serialize($value))
    [Console]::Out.Flush()
}
Emit @{ status = 'reader-progress'; phase = 'initializing' }
$uiaAvailable = $false
$msaaAvailable = $false
if ($ReaderMode -ne 'msaa') {
    try {
        Add-Type -AssemblyName UIAutomationClient
        Add-Type -AssemblyName UIAutomationTypes
        $uiaAvailable = $true
    } catch { }
}
if ($ReaderMode -ne 'uia') {
    try {
        Add-Type -AssemblyName Accessibility
        $msaaPath = [IO.Path]::Combine([IO.Path]::GetDirectoryName($MyInvocation.MyCommand.Path), 'das-msaa.dll')
        [void][Reflection.Assembly]::LoadFrom($msaaPath)
        $msaaAvailable = $true
    } catch { }
}
if (($ReaderMode -eq 'msaa' -and -not $msaaAvailable) -or ($ReaderMode -eq 'uia' -and -not $uiaAvailable) -or (-not $uiaAvailable -and -not $msaaAvailable)) {
    Emit @{ status = 'reader-error'; reason = 'provider-unavailable' }
    exit 1
}

function Normalize($text) {
    if ($msaaAvailable) { return [CISAccessibility]::Normalize([string]$text) }
    $value = ([string]$text).Normalize([Text.NormalizationForm]::FormD).ToLowerInvariant().Replace([char]0x0111, [char]'d')
    return $value -replace '[^a-z0-9]', ''
}

# Configuration is immutable for this reader's lifetime; saving restarts it.
try { $config = $serializer.DeserializeObject([IO.File]::ReadAllText($ConfigPath, [Text.Encoding]::UTF8)) }
catch { Emit @{ status = 'reader-error'; reason = 'config-unreadable' }; exit 1 }
$aliases = @($config['weight']) + @($config['height']) + @($config['age']) + @($config['encounter']) + @($config['patient'])
$script:aliasNames = @{}
$script:aliasFields = @{}
foreach ($field in @('weight', 'height', 'age', 'encounter', 'patient')) {
    foreach ($alias in $config[$field]) {
        $normalized = Normalize $alias
        $script:aliasNames[$normalized] = [string]$alias
        $script:aliasFields[$normalized] = [string]$field
    }
}

function Semantic($text, $aliases) {
    $prefix = ([string]$text).Replace([char]0xFF1A, [char]':').Split(':')[0]
    $normalized = Normalize $prefix
    if ($script:aliasNames.ContainsKey($normalized)) { return $script:aliasNames[$normalized] }
    return $null
}
function Read-Value($element, $current, $aliases) {
    $pattern = $null
    if ($element.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$pattern)) { return [string]$pattern.Current.Value }
    if ($element.TryGetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern, [ref]$pattern)) { return [string]$pattern.DocumentRange.GetText(101) }
    # A single labelled text node, never an adjacent number.
    $name = ([string]$current.Name).Replace([char]0xFF1A, [char]':')
    if ($name.Contains(':')) { return $name.Substring($name.IndexOf(':') + 1).Trim() }
    if ($current.ControlType -eq [System.Windows.Automation.ControlType]::Text -and -not (Semantic $name $aliases)) { return $name }
    return ''
}
function Read-UIA($root, $aliases) {
    $records = New-Object System.Collections.ArrayList
    # Fetch descriptors in one batch for this scan only. Pattern values remain
    # fresh reads and no clinical values or element references survive a scan.
    $cache = New-Object System.Windows.Automation.CacheRequest
    $cache.Add([System.Windows.Automation.AutomationElement]::NameProperty)
    $cache.Add([System.Windows.Automation.AutomationElement]::AutomationIdProperty)
    $cache.Add([System.Windows.Automation.AutomationElement]::IsOffscreenProperty)
    $cache.Add([System.Windows.Automation.AutomationElement]::LabeledByProperty)
    $cache.Add([System.Windows.Automation.AutomationElement]::ControlTypeProperty)
    $activation = $cache.Activate()
    try { $elements = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition) }
    finally { $activation.Dispose() }
    # A truncated search must not silently hide a second patient form.
    if ($elements.Count -gt 2500) { throw 'UIA scan exceeds its safe node limit.' }
    $count = 0
    foreach ($element in $elements) {
        if ($count++ -gt 2500) { break }
        try {
            $current = $element.Cached
            if ($current.IsOffscreen) { continue }
            $id = Semantic $current.AutomationId $aliases
            $name = Semantic $current.Name $aliases
            $label = $null
            if (-not $id -and -not $name -and $current.LabeledBy) { $label = Semantic $current.LabeledBy.Current.Name $aliases }
            if (-not $id -and -not $name -and -not $label) { continue }
            $value = Read-Value $element $current $aliases
            if (-not $value -or $value.Length -gt 100) { continue }
            $scope = ''
            $parent = $element
            for ($i = 0; $i -lt 20 -and $parent; $i++) {
                $class = [string]$parent.Current.ClassName
                if ($class -match '(?i)^pbdw|datawindow') { $scope = [string]$parent.Current.NativeWindowHandle; break }
                $parent = ([System.Windows.Automation.TreeWalker]::RawViewWalker).GetParent($parent)
            }
            [void]$records.Add(@{ id = $id; name = $name; label = $label; value = [string]$value; node = ($element.GetRuntimeId() -join '.'); scope = $scope; provider = 'uia'; visible = $true })
        } catch { } # A changing form is rejected by the native stability gate.
    }
    return ,$records
}
function Has-FullTuple($records) {
    $fields = @{ weight = @(); height = @(); age = @(); encounter = @(); patient = @() }
    foreach ($record in $records) {
        foreach ($text in @($record.id, $record.name, $record.label)) {
            $field = $script:aliasFields[(Normalize $text)]
            if ($field) { $fields[$field] += $record; break }
        }
    }
    $keys = $fields.patient
    if ($fields.encounter.Count -gt 0) { $keys = $fields.encounter }
    if ($fields.weight.Count -ne 1 -or $fields.age.Count -ne 1 -or $keys.Count -ne 1 -or $fields.height.Count -ne 1) { return $false }
    $identity = ([string]$keys[0].value).Trim().ToLowerInvariant()
    if (-not $identity -or @('0', '-1', 'null', '--') -contains $identity) { return $false }
    $scope = [string]$fields.weight[0].scope
    if ([string]$fields.age[0].scope -ne $scope -or [string]$keys[0].scope -ne $scope -or [string]$fields.height[0].scope -ne $scope) { return $false }
    $heightMatch = [regex]::Match(([string]$fields.height[0].value).Trim(), '^(\d+(?:[.,]\d+)?)\s*(cm|m)?$', 'IgnoreCase')
    if (-not $heightMatch.Success) { return $false }
    $heightCm = [double]::Parse($heightMatch.Groups[1].Value.Replace(',', '.'), [Globalization.CultureInfo]::InvariantCulture)
    if ($heightMatch.Groups[2].Value.ToLowerInvariant() -eq 'm') { $heightCm *= 100 }
    return $heightCm -ge 20 -and $heightCm -le 250
}
function Snapshot {
    # DAS115YD is the bundle name. The clinical process is CISV3115YD.
    $processes = @(Get-Process -Name 'CISV3115YD' -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 })
    if ($processes.Count -eq 0) { return @{ status = 'not-found' } }
    if ($processes.Count -ne 1) { return @{ status = 'ambiguous' } }
    $process = $processes[0]
    $records = New-Object System.Collections.ArrayList
    if ($uiaAvailable) {
        Emit @{ status = 'reader-progress'; phase = 'uia' }
        try {
            $root = [System.Windows.Automation.AutomationElement]::FromHandle($process.MainWindowHandle)
            foreach ($record in (Read-UIA $root $aliases)) { [void]$records.Add($record) }
        } catch { }
    }
    # UIA already supplied all four fields: avoid a second full native walk.
    # Otherwise MSAA may supply its own whole tuple, including optional height.
    if ($msaaAvailable -and $ReaderMode -ne 'uia' -and -not (Has-FullTuple $records)) {
        Emit @{ status = 'reader-progress'; phase = 'msaa' }
        try {
            foreach ($record in [CISAccessibility]::Read($process.MainWindowHandle, [string[]]$aliases)) { [void]$records.Add($record) }
        } catch { } # A failing optional provider must not discard valid UIA.
    }
    return @{ status = 'scan'; processName = 'CISV3115YD'; processId = $process.Id; window = $process.MainWindowHandle.ToInt64().ToString(); records = @($records.ToArray()) }
}
do {
    try { $snapshot = Snapshot }
    catch { $snapshot = @{ status = 'unreadable' } }
    Emit $snapshot
    if (-not $Inspect) {
        $delayMs = 350
        if ($snapshot.status -eq 'not-found') { $delayMs = 1200 }
        Start-Sleep -Milliseconds $delayMs
    }
} while (-not $Inspect)
