; Run Inno Setup on Windows after build.py. Override PackageDir at compile time.
#ifndef PackageDir
  #define PackageDir "..\..\..\dist\communicator\EksteelCommunicator"
#endif
[Setup]
AppId=Eksteel.Communicator.FEA
AppName=Eksteel Comunicador FEA
AppVersion=0.1.0
DefaultDirName={localappdata}\Programs\EksteelFEA
DefaultGroupName=Eksteel FEA
PrivilegesRequired=lowest
OutputBaseFilename=EksteelComunicador-Setup
Compression=lzma2
SolidCompression=yes
UninstallDisplayIcon={app}\EksteelCommunicator.exe
[Files]
Source: "{#PackageDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
[Icons]
Name: "{group}\Eksteel Comunicador FEA"; Filename: "{app}\EksteelCommunicator.exe"
Name: "{autodesktop}\Eksteel Comunicador FEA"; Filename: "{app}\EksteelCommunicator.exe"
[Run]
Filename: "{app}\EksteelCommunicator.exe"; Description: "Abrir comunicador"; Flags: nowait postinstall skipifsilent
[Registry]
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueName: "EksteelFEA"; Flags: uninsdeletevalue
