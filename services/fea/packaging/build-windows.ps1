# Run on Windows with Python 3.11+ and Inno Setup 6 installed.
# CalculiX and its required DLLs must come from a trusted Windows distribution.
param(
    [Parameter(Mandatory=$true)][string]$Calculix,
    [Parameter(Mandatory=$true)][string]$Notices,
    [string]$NativeDir,
    [string]$InnoCompiler,
    [string]$PythonExecutable
)
$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') { throw 'Execute este script no Windows.' }
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../../..')).Path
$solver = (Resolve-Path $Calculix).Path
$licenses = (Resolve-Path $Notices).Path
if (-not (Test-Path $solver -PathType Leaf)) { throw 'Informe o ccx.exe do Windows.' }
if (-not (Test-Path $licenses -PathType Container)) { throw 'Informe a pasta de licenças e fontes correspondentes.' }
$native = if ($NativeDir) { (Resolve-Path $NativeDir).Path } else { Split-Path $solver }
if (-not $InnoCompiler) {
    $innoCommand = Get-Command ISCC.exe -ErrorAction SilentlyContinue
    if ($innoCommand) { $InnoCompiler = $innoCommand.Source }
    else { $InnoCompiler = Join-Path ${env:ProgramFiles(x86)} 'Inno Setup 6/ISCC.exe' }
}
if (-not (Test-Path $InnoCompiler -PathType Leaf)) { throw 'Instale Inno Setup 6 ou informe -InnoCompiler com o caminho de ISCC.exe.' }
$pythonLauncher = if ($PythonExecutable) { (Resolve-Path $PythonExecutable).Path } else { (Get-Command py.exe -ErrorAction Stop).Source }
$pythonArguments = if ($PythonExecutable) { @() } else { @('-3') }
function Run-Checked([string]$Program, [string[]]$Arguments) {
    & $Program @Arguments
    if ($LASTEXITCODE -ne 0) { throw "Falha em $Program (código $LASTEXITCODE)." }
}
Run-Checked $pythonLauncher ($pythonArguments + @('-c', 'import sys; assert sys.version_info >= (3,11), "Python 3.11+ necessario"; import tkinter'))
$buildEnv = Join-Path $repoRoot 'dist/communicator-build-env'
Run-Checked $pythonLauncher ($pythonArguments + @('-m', 'venv', $buildEnv))
$python = Join-Path $buildEnv 'Scripts/python.exe'
Run-Checked $python @('-m', 'pip', 'install', '-r', (Join-Path $repoRoot 'services/fea/requirements.txt'), 'pyinstaller>=6.11,<7')
$output = Join-Path $repoRoot 'dist/communicator'
Run-Checked $python @((Join-Path $PSScriptRoot 'build.py'), '--calculix', $solver, '--notices', $licenses, '--native-dir', $native, '--output', $output)
$package = Join-Path $output 'EksteelCommunicator'
# Exercise the bundled runtime before offering an installer to end users.
$previousCommunicator = $env:FEA_COMMUNICATOR_EXE
try {
    $env:FEA_COMMUNICATOR_EXE = Join-Path $package 'EksteelCommunicator.exe'
    Run-Checked $python @('-m', 'unittest', 'discover', '-s', (Join-Path $repoRoot 'services/fea'), '-p', 'test_communicator.py')
} finally {
    if ($null -eq $previousCommunicator) { Remove-Item Env:FEA_COMMUNICATOR_EXE -ErrorAction SilentlyContinue }
    else { $env:FEA_COMMUNICATOR_EXE = $previousCommunicator }
}
Run-Checked $InnoCompiler @("/DPackageDir=$package", "/O$output", (Join-Path $PSScriptRoot 'windows.iss'))
$installer = Join-Path $output 'EksteelComunicador-Setup.exe'
if (-not (Test-Path $installer -PathType Leaf)) { throw 'O instalador não foi encontrado após a compilação.' }
Get-FileHash $installer -Algorithm SHA256
Write-Host "Instalador criado em $installer"
Write-Host 'Valide em um Windows sem Python: instalação, conexão ao site, malha e cálculo. Depois publique o instalador e configure FEA_COMMUNICATOR_WINDOWS_URL no site.'
