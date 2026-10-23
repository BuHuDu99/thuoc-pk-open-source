param([Parameter(Mandatory = $true)][string]$FrameworkReferences)
# Build-time only, using PowerShell 7's Roslyn compiler. The emitted library
# targets CLR 2 / .NET 3.5 and requires no compiler on the clinical PC.
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$refs = @('mscorlib.dll', 'System.dll', 'Accessibility.dll') | ForEach-Object { Join-Path $FrameworkReferences $_ }
foreach ($file in $refs) { if (-not (Test-Path $file)) { throw "Missing official framework reference: $file" } }
$roslyn = @('Microsoft.CodeAnalysis.dll', 'Microsoft.CodeAnalysis.CSharp.dll') | ForEach-Object { Join-Path $PSHOME $_ }
foreach ($file in $roslyn) { [void][Reflection.Assembly]::LoadFrom($file) }
$source = [IO.File]::ReadAllText((Join-Path $root 'src/das-msaa.cs'))
$parseOptions = [Microsoft.CodeAnalysis.CSharp.CSharpParseOptions]::Default.WithLanguageVersion([Microsoft.CodeAnalysis.CSharp.LanguageVersion]::CSharp3)
$tree = [Microsoft.CodeAnalysis.CSharp.CSharpSyntaxTree]::ParseText($source, $parseOptions)
$references = [Microsoft.CodeAnalysis.MetadataReference[]]@($refs | ForEach-Object { [Microsoft.CodeAnalysis.MetadataReference]::CreateFromFile($_) })
$options = [Microsoft.CodeAnalysis.CSharp.CSharpCompilationOptions]::new([Microsoft.CodeAnalysis.OutputKind]::DynamicallyLinkedLibrary)
$options = $options.WithPlatform([Microsoft.CodeAnalysis.Platform]::AnyCpu).WithOptimizationLevel([Microsoft.CodeAnalysis.OptimizationLevel]::Release).WithDeterministic($true)
$compilation = [Microsoft.CodeAnalysis.CSharp.CSharpCompilation]::Create('CISAccessibility', [Microsoft.CodeAnalysis.SyntaxTree[]]@($tree), $references, $options)
$output = Join-Path $root 'src/das-msaa.dll'
$stream = [IO.File]::Create($output)
try {
    $emitOptions = [Microsoft.CodeAnalysis.Emit.EmitOptions]::new().WithRuntimeMetadataVersion('v2.0.50727')
    $result = $compilation.Emit($stream, $null, $null, $null, $null, $emitOptions)
    if (-not $result.Success) { throw ($result.Diagnostics | Out-String) }
} finally { $stream.Dispose() }
$sourceHash = (Get-FileHash (Join-Path $root 'src/das-msaa.cs') -Algorithm SHA256).Hash.ToLowerInvariant()
$binaryHash = (Get-FileHash $output -Algorithm SHA256).Hash.ToLowerInvariant()
[IO.File]::WriteAllText((Join-Path $root 'src/das-msaa.build.json'), ('{"sourceSha256":"' + $sourceHash + '","binarySha256":"' + $binaryHash + '","runtime":"v2.0.50727","platform":"AnyCPU","language":"CSharp3"}'))
Write-Output 'PASS: deterministic AnyCPU helper compiled for CLR 2 / .NET 3.5, with C# 3 language checks.'
