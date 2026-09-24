#ifndef MyAppVersion
  #error MyAppVersion is required
#endif
#ifndef MySourceDir
  #error MySourceDir is required
#endif
#ifndef MyOutputDir
  #error MyOutputDir is required
#endif
[Setup]
AppId={{d90c2a54-f9ed-4c12-885a-c6992e1d78cf}
AppName=XMAI Studio 测试版
AppVersion={#MyAppVersion}
AppPublisher=先马
DefaultDirName={autopf}\XMAI Studio Preview
DefaultGroupName=XMAI Studio 测试版
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
PrivilegesRequired=admin
MinVersion=10.0.17763
OutputBaseFilename=XMAI Studio Preview Setup {#MyAppVersion}
OutputDir={#MyOutputDir}
SetupIconFile={#SourcePath}\icon.ico
UninstallDisplayIcon={app}\XMAI Studio Preview.exe
UninstallDisplayName=XMAI Studio 测试版
Compression=lzma2/fast
SolidCompression=yes
CloseApplications=yes
CloseApplicationsFilter=XMAI Studio Preview.exe
RestartApplications=no
WizardStyle=modern
SetupLogging=yes
[Languages]
Name: "chinesesimplified"; MessagesFile: "compiler:Languages\ChineseSimplified.isl"
[Files]
Source: "{#MySourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#SourcePath}\installer-config\dingtalk-config.json"; DestDir: "{commonappdata}\XianmaAIStudioPreview"; Flags: onlyifdoesntexist uninsneveruninstall
Source: "{#SourcePath}\installer-config\computer-access.json"; DestDir: "{commonappdata}\XianmaAIStudioPreview"; Flags: onlyifdoesntexist uninsneveruninstall
Source: "{#SourcePath}\runtime-tools\media\*"; DestDir: "{commonappdata}\XianmaAIStudioPreview\media-runtime"; Flags: ignoreversion recursesubdirs createallsubdirs
[Icons]
Name: "{group}\XMAI Studio 测试版"; Filename: "{app}\XMAI Studio Preview.exe"; AppUserModelID: "com.xianma.ai-studio.preview"
Name: "{autodesktop}\XMAI Studio 测试版"; Filename: "{app}\XMAI Studio Preview.exe"; AppUserModelID: "com.xianma.ai-studio.preview"
[Run]
Filename: "{app}\XMAI Studio Preview.exe"; Description: "启动 XMAI Studio 测试版"; Flags: nowait postinstall skipifsilent
