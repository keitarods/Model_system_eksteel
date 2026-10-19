; Run Inno Setup on Windows after build.py. Override PackageDir at compile time.
#ifndef PackageDir
  #define PackageDir "..\..\..\dist\communicator\emekaengCommunicator"
#endif
#if !FileExists(PackageDir + "\emekaengCommunicator.exe")
  #error Gere primeiro o pacote Windows completo com build-windows.ps1.
#endif
#if !FileExists(PackageDir + "\_internal\native\ccx.exe")
  #error O pacote precisa incluir o motor CalculiX; nao distribua um instalador incompleto.
#endif
[Setup]
AppId=Eksteel.Communicator.FEA
AppName=emekaengCommunicator
AppVersion=2026.10.18.1
DefaultDirName={localappdata}\Programs\EksteelFEA
DefaultGroupName=emekaengCommunicator
PrivilegesRequired=lowest
WizardStyle=modern
DisableDirPage=yes
DisableProgramGroupPage=yes
InfoBeforeFile=install-info.txt
OutputBaseFilename=emekaengCommunicator-Setup
Compression=lzma2/ultra64
SolidCompression=yes
UninstallDisplayIcon={app}\emekaengCommunicator.exe
[Languages]
Name: "brazilianportuguese"; MessagesFile: "compiler:Languages\BrazilianPortuguese.isl"
[Files]
Source: "{#PackageDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
[Icons]
Name: "{group}\emekaengCommunicator"; Filename: "{app}\emekaengCommunicator.exe"
Name: "{autodesktop}\emekaengCommunicator"; Filename: "{app}\emekaengCommunicator.exe"
[Run]
Filename: "{app}\emekaengCommunicator.exe"; Description: "Abrir comunicador"; Flags: nowait postinstall skipifsilent
[Registry]
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueName: "EksteelFEA"; Flags: uninsdeletevalue
