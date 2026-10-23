param([string]$AccessibilityReference)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$tokens = $null
$errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile((Join-Path $root 'src/das-reader.ps1'), [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw ($errors | Out-String) }
Write-Output 'PASS: PowerShell reader parses without syntax errors.'

# Exercise the actual shipped DLL, without invoking Windows COM or CIS.
[void][Reflection.Assembly]::LoadFrom($AccessibilityReference)
$assembly = [Reflection.Assembly]::LoadFrom((Join-Path $root 'src/das-msaa.dll'))
if ($assembly.ImageRuntimeVersion -ne 'v2.0.50727') { throw 'Helper does not target the Windows 7 CLR 2 runtime.' }
foreach ($reference in $assembly.GetReferencedAssemblies()) {
    if (@('mscorlib', 'Accessibility', 'System') -notcontains $reference.Name -or $reference.Version.Major -ne 2) { throw "Unexpected helper dependency: $reference" }
}
Write-Output 'PASS: shipped MSAA DLL loads and references only CLR 2 / Accessibility 2 APIs.'

# Exercise the actual PowerShell fast-path decision using synthetic records.
$functions = @('Normalize', 'Semantic', 'Has-FullTuple')
foreach ($name in $functions) {
    $definition = $ast.Find({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name }, $true)
    . ([scriptblock]::Create($definition.Extent.Text))
}
$script:aliasNames = @{ weight = 'weight'; height = 'height'; tuoi = 'tuoi'; patcd = 'patcd' }
$script:aliasFields = @{ weight = 'weight'; height = 'height'; tuoi = 'age'; patcd = 'patient' }
function Records {
    return @(
        @{ id = 'weight'; value = '12,5 kg'; scope = '8192' },
        @{ id = 'tuoi'; value = '18 thang'; scope = '8192' },
        @{ id = 'patcd'; value = 'TEST-ONLY'; scope = '8192' },
        @{ id = 'height'; value = '82'; scope = '8192' }
    )
}
$records = Records
if (-not (Has-FullTuple $records)) { throw 'Full UIA tuple did not select the fast path.' }
$records[3].value = '0.82 m'
if (-not (Has-FullTuple $records)) { throw 'Explicit metres did not select the fast path.' }
foreach ($value in @('', '0', '1.2', '999', '82 kg')) {
    $records = Records; $records[3].value = $value
    if (Has-FullTuple $records) { throw 'Invalid height skipped the MSAA fallback.' }
}
$records = Records; $records[3].scope = 'other-form'
if (Has-FullTuple $records) { throw 'Height from another form skipped the fallback.' }
$records = Records; $records[2].value = '0'
if (Has-FullTuple $records) { throw 'Placeholder identity skipped the fallback.' }
$records = Records; $records += @{ id = 'height'; value = '83'; scope = '8192' }
if (Has-FullTuple $records) { throw 'Duplicate height skipped the fallback.' }
if ((Semantic 'HEIGHT：82' @()) -ne 'height') { throw 'Fullwidth colon alias failed.' }
Write-Output 'PASS: PowerShell fast path accepts only a complete, unambiguous same-form tuple; fallback remains available otherwise.'
