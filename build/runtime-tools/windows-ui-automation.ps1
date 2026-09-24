param(
  [Parameter(Mandatory = $true)]
  [string]$PayloadBase64
)

$ErrorActionPreference = "Stop"
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public static class XianmaDesktopNative {
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }

  [DllImport("user32.dll")]
  public static extern bool SetForegroundWindow(IntPtr hWnd);

  [DllImport("user32.dll")]
  public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);

  [DllImport("user32.dll")]
  public static extern bool IsIconic(IntPtr hWnd);

  [DllImport("user32.dll")]
  public static extern bool SetCursorPos(int x, int y);

  [DllImport("user32.dll")]
  public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);

  [DllImport("user32.dll")]
  public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdcBlt, uint flags);

  [DllImport("user32.dll")]
  public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extraInfo);

  [DllImport("user32.dll", CharSet = CharSet.Auto)]
  public static extern IntPtr SendMessage(IntPtr hWnd, uint message, IntPtr wParam, IntPtr lParam);

  [DllImport("user32.dll")]
  public static extern IntPtr GetForegroundWindow();

  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
}
"@

function Write-Result($Value) {
  $Value | ConvertTo-Json -Depth 10 -Compress
}

function Get-IntegerOrDefault($Value, [int]$DefaultValue) {
  if ($null -eq $Value -or [string]::IsNullOrWhiteSpace([string]$Value)) { return $DefaultValue }
  return [int]$Value
}

function Get-AppTerms([string]$Query) {
  $value = ([string]$Query).Trim().ToLowerInvariant()
  if ($value -match "microsoft\s*edge|msedge|edge|微软.*浏览器|微软浏览器|micsoft.*浏览器|microsoft.*浏览器") {
    return @("microsoft edge", "msedge", "edge", "微软浏览器", "微软")
  }
  if ($value -match "google\s*chrome|chrome|谷歌.*浏览器|谷歌浏览器|google.*浏览器") {
    return @("google chrome", "chrome", "谷歌浏览器", "谷歌")
  }
  if ($value -match "浏览器|browser") {
    return @("microsoft edge", "msedge", "edge")
  }
  if ($value -match "微信|wechat|weixin") { return @("微信", "wechat", "weixin", "wechatstore") }
  if ($value -match "飞书|feishu|lark") { return @("飞书", "feishu", "lark") }
  if ($value -match "钉钉|dingtalk") { return @("钉钉", "dingtalk") }
  if ($value -match "记事本|notepad") { return @("记事本", "notepad") }
  if ($value -match "计算器|calculator|calc") { return @("计算器", "calculator", "calc") }
  return @($value)
}

function Get-ProcessPathSafe([int]$ProcessId) {
  try { return (Get-Process -Id $ProcessId -ErrorAction Stop).Path } catch { return "" }
}

function Get-ProcessNameSafe([int]$ProcessId) {
  try { return (Get-Process -Id $ProcessId -ErrorAction Stop).ProcessName } catch { return "" }
}

function Get-ControlTypeName($Element) {
  try { return ([string]$Element.Current.ControlType.ProgrammaticName).Replace("ControlType.", "") } catch { return "" }
}

function Get-WindowElements {
  $items = @()
  $root = [System.Windows.Automation.AutomationElement]::RootElement
  $windows = $root.FindAll(
    [System.Windows.Automation.TreeScope]::Children,
    [System.Windows.Automation.Condition]::TrueCondition
  )
  foreach ($window in $windows) {
    try {
      $handle = [int]$window.Current.NativeWindowHandle
      $processId = [int]$window.Current.ProcessId
      if ($handle -eq 0 -or $processId -le 0) { continue }
      $items += [pscustomobject]@{
        Element = $window
        Handle = $handle
        ProcessId = $processId
        ProcessName = Get-ProcessNameSafe $processId
        ProcessPath = Get-ProcessPathSafe $processId
        Title = [string]$window.Current.Name
        ClassName = [string]$window.Current.ClassName
        AutomationId = [string]$window.Current.AutomationId
        IsEnabled = [bool]$window.Current.IsEnabled
        IsOffscreen = [bool]$window.Current.IsOffscreen
      }
    } catch {
      continue
    }
  }
  return @($items)
}

function Convert-WindowRecord($Window) {
  return [pscustomobject]@{
    handle = $Window.Handle
    processId = $Window.ProcessId
    processName = $Window.ProcessName
    processPath = $Window.ProcessPath
    title = $Window.Title
    className = $Window.ClassName
    automationId = $Window.AutomationId
    isEnabled = $Window.IsEnabled
    isOffscreen = $Window.IsOffscreen
  }
}

function Find-AppWindow([string]$Query, [int]$WindowHandle = 0) {
  $windows = @(Get-WindowElements)
  if ($WindowHandle -ne 0) {
    $byHandle = $windows | Where-Object { $_.Handle -eq $WindowHandle } | Select-Object -First 1
    if ($byHandle) { return $byHandle }
  }
  $terms = @(Get-AppTerms $Query)
  $matches = @($windows | Where-Object {
    $search = "$($_.ProcessName) $($_.ProcessPath) $($_.Title) $($_.ClassName)".ToLowerInvariant()
    ($terms | Where-Object { $_ -and $search.Contains($_.ToLowerInvariant()) }).Count -gt 0
  })
  if (!$matches.Count) { return $null }
  return $matches |
    Sort-Object @{ Expression = {
      $title = ([string]$_.Title).ToLowerInvariant()
      if (($terms | Where-Object { $_ -and $title -eq $_.ToLowerInvariant() }).Count -gt 0) { return 0 }
      if (([string]$_.ClassName) -match "Main|Chrome_WidgetWin_1") { return 1 }
      if (($terms | Where-Object { $_ -and $title.Contains($_.ToLowerInvariant()) }).Count -gt 0) { return 2 }
      return 3
    } }, @{ Expression = { if ($_.IsOffscreen) { 1 } else { 0 } } }, @{ Expression = { if ($_.Title) { 0 } else { 1 } } } |
    Select-Object -First 1
}

function Focus-AppWindow($Window) {
  if (!$Window) { throw "没有找到可操作的应用窗口" }
  $handle = [IntPtr]$Window.Handle
  if ([XianmaDesktopNative]::IsIconic($handle)) {
    [void][XianmaDesktopNative]::ShowWindowAsync($handle, 9)
    Start-Sleep -Milliseconds 180
  } else {
    [void][XianmaDesktopNative]::ShowWindowAsync($handle, 5)
  }
  try { [void]$Window.Element.SetFocus() } catch { }
  try {
    $shell = New-Object -ComObject WScript.Shell
    [void]$shell.AppActivate($Window.ProcessId)
  } catch { }
  [void][XianmaDesktopNative]::SetForegroundWindow($handle)
  Start-Sleep -Milliseconds 180
  return (Convert-WindowRecord $Window)
}

function Get-CommonExecutableCandidates([string]$Query) {
  $value = ([string]$Query).Trim().ToLowerInvariant()
  $candidates = New-Object System.Collections.Generic.List[string]
  if ($value -match "microsoft\s*edge|msedge|edge|微软.*浏览器|微软浏览器|micsoft.*浏览器|microsoft.*浏览器|^浏览器$|^browser$") {
    $candidates.Add((Join-Path ${env:ProgramFiles(x86)} "Microsoft\Edge\Application\msedge.exe"))
    $candidates.Add((Join-Path $env:ProgramFiles "Microsoft\Edge\Application\msedge.exe"))
    $candidates.Add((Join-Path $env:LOCALAPPDATA "Microsoft\Edge\Application\msedge.exe"))
  }
  if ($value -match "google\s*chrome|chrome|谷歌.*浏览器|谷歌浏览器|google.*浏览器") {
    $candidates.Add((Join-Path $env:ProgramFiles "Google\Chrome\Application\chrome.exe"))
    $candidates.Add((Join-Path ${env:ProgramFiles(x86)} "Google\Chrome\Application\chrome.exe"))
    $candidates.Add((Join-Path $env:LOCALAPPDATA "Google\Chrome\Application\chrome.exe"))
  }
  if ($value -match "微信|wechat|weixin") {
    foreach ($drive in Get-PSDrive -PSProvider FileSystem -ErrorAction SilentlyContinue) {
      $candidates.Add((Join-Path $drive.Root "Program Files\Tencent\WeChat\WeChat.exe"))
      $candidates.Add((Join-Path $drive.Root "Program Files (x86)\Tencent\WeChat\WeChat.exe"))
      $candidates.Add((Join-Path $drive.Root "Program Files\Tencent\Weixin\Weixin.exe"))
    }
    $candidates.Add((Join-Path $env:LOCALAPPDATA "Tencent\WeChat\WeChat.exe"))
  }
  if ($value -match "飞书|feishu|lark") {
    foreach ($drive in Get-PSDrive -PSProvider FileSystem -ErrorAction SilentlyContinue) {
      $candidates.Add((Join-Path $drive.Root "Program Files\Feishu\app\Feishu.exe"))
      $candidates.Add((Join-Path $drive.Root "Program Files\Lark\app\Lark.exe"))
    }
    $candidates.Add((Join-Path $env:LOCALAPPDATA "Feishu\Feishu.exe"))
    $candidates.Add((Join-Path $env:LOCALAPPDATA "Programs\Lark\Lark.exe"))
  }
  if ($value -match "钉钉|dingtalk") {
    foreach ($drive in Get-PSDrive -PSProvider FileSystem -ErrorAction SilentlyContinue) {
      $candidates.Add((Join-Path $drive.Root "Program Files (x86)\DingDing\main\current\DingTalk.exe"))
      $candidates.Add((Join-Path $drive.Root "Program Files\DingDing\main\current\DingTalk.exe"))
    }
  }
  if ($value -match "记事本|notepad") { $candidates.Add("$env:SystemRoot\System32\notepad.exe") }
  if ($value -match "计算器|calculator|calc") { $candidates.Add("$env:SystemRoot\System32\calc.exe") }
  return @($candidates | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) } | Select-Object -Unique)
}

function Find-InstalledExecutable([string]$Query) {
  $terms = @(Get-AppTerms $Query)
  $registryPaths = @(
    "HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*",
    "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*",
    "HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*"
  )
  $entries = @(Get-ItemProperty $registryPaths -ErrorAction SilentlyContinue | Where-Object {
    $display = ([string]$_.DisplayName).ToLowerInvariant()
    ($terms | Where-Object { $_ -and $display.Contains($_.ToLowerInvariant()) }).Count -gt 0
  })
  foreach ($entry in $entries) {
    $paths = New-Object System.Collections.Generic.List[string]
    $displayIcon = ([string]$entry.DisplayIcon).Trim('"') -replace ',\d+$', ''
    if ($displayIcon) { $paths.Add($displayIcon) }
    $installLocation = ([string]$entry.InstallLocation).Trim('"')
    if ($installLocation) {
      $paths.Add((Join-Path $installLocation "Feishu.exe"))
      $paths.Add((Join-Path $installLocation "app\Feishu.exe"))
      $paths.Add((Join-Path $installLocation "WeChat.exe"))
      $paths.Add((Join-Path $installLocation "DingTalk.exe"))
      $genericExecutables = @(
        Get-ChildItem -LiteralPath $installLocation -Filter "*.exe" -File -ErrorAction SilentlyContinue
        Get-ChildItem -LiteralPath $installLocation -Directory -ErrorAction SilentlyContinue |
          Select-Object -First 30 |
          ForEach-Object { Get-ChildItem -LiteralPath $_.FullName -Filter "*.exe" -File -ErrorAction SilentlyContinue }
      ) | Where-Object { $_.BaseName -notmatch "unins|uninstall|update|setup|crash|report|helper" }
      $preferredExecutables = @($genericExecutables | Where-Object {
        $fileName = $_.BaseName.ToLowerInvariant()
        ($terms | Where-Object { $_ -and $fileName.Contains($_.ToLowerInvariant()) }).Count -gt 0
      })
      foreach ($executable in @($preferredExecutables + $genericExecutables | Select-Object -Unique)) {
        $paths.Add($executable.FullName)
      }
    }
    foreach ($candidate in $paths) {
      if ($candidate -and (Test-Path -LiteralPath $candidate -PathType Leaf) -and [IO.Path]::GetExtension($candidate) -ieq ".exe") {
        return $candidate
      }
    }
  }
  return ""
}

function Start-App([string]$Query, [int]$WaitMs = 15000) {
  $existing = Find-AppWindow $Query 0
  if ($existing) {
    [void](Focus-AppWindow $existing)
    return [pscustomobject]@{ launched = $false; window = Convert-WindowRecord $existing; source = "running" }
  }

  $started = $false
  $source = ""
  if (Test-Path -LiteralPath $Query -PathType Leaf) {
    [void](Start-Process -FilePath (Resolve-Path -LiteralPath $Query).Path -PassThru)
    $started = $true
    $source = "path"
  }
  if (!$started) {
    $candidate = @(Get-CommonExecutableCandidates $Query) | Select-Object -First 1
    if (!$candidate) { $candidate = Find-InstalledExecutable $Query }
    if ($candidate) {
      [void](Start-Process -FilePath $candidate -PassThru)
      $started = $true
      $source = "installed"
    }
  }
  if (!$started) {
    $terms = @(Get-AppTerms $Query)
    $startApp = Get-StartApps -ErrorAction SilentlyContinue | Where-Object {
      $name = ([string]$_.Name).ToLowerInvariant()
      ($terms | Where-Object { $_ -and $name.Contains($_.ToLowerInvariant()) }).Count -gt 0
    } | Select-Object -First 1
    if ($startApp) {
      [void](Start-Process -FilePath "explorer.exe" -ArgumentList "shell:AppsFolder\$($startApp.AppID)" -PassThru)
      $started = $true
      $source = "start-menu"
    }
  }
  if (!$started) {
    try {
      [void](Start-Process -FilePath $Query -PassThru)
      $started = $true
      $source = "command"
    } catch {
      throw "没有找到应用：$Query"
    }
  }

  $deadline = [DateTime]::UtcNow.AddMilliseconds([Math]::Max(1000, $WaitMs))
  do {
    Start-Sleep -Milliseconds 300
    $window = Find-AppWindow $Query 0
    if ($window) {
      [void](Focus-AppWindow $window)
      return [pscustomobject]@{ launched = $true; window = Convert-WindowRecord $window; source = $source }
    }
  } while ([DateTime]::UtcNow -lt $deadline)

  return [pscustomobject]@{ launched = $true; window = $null; source = $source; message = "应用已启动，但暂未检测到主窗口" }
}

function Get-ControlRecord($Element, [int]$Index) {
  try {
    $rect = $Element.Current.BoundingRectangle
    return [pscustomobject]@{
      index = $Index
      name = [string]$Element.Current.Name
      automationId = [string]$Element.Current.AutomationId
      controlType = Get-ControlTypeName $Element
      className = [string]$Element.Current.ClassName
      isEnabled = [bool]$Element.Current.IsEnabled
      isOffscreen = [bool]$Element.Current.IsOffscreen
      isKeyboardFocusable = [bool]$Element.Current.IsKeyboardFocusable
      isPassword = [bool]$Element.Current.IsPassword
      bounds = [pscustomobject]@{ x = [int]$rect.X; y = [int]$rect.Y; width = [int]$rect.Width; height = [int]$rect.Height }
    }
  } catch {
    return $null
  }
}

function Test-ControlSelector($Element, $Selector) {
  try {
    if (!$Selector) { return $true }
    $name = [string]$Element.Current.Name
    $automationId = [string]$Element.Current.AutomationId
    $controlType = Get-ControlTypeName $Element
    $className = [string]$Element.Current.ClassName
    if ($Selector.name) {
      if ($Selector.contains -eq $false) {
        if ($name -ine [string]$Selector.name) { return $false }
      } elseif (!$name.ToLowerInvariant().Contains(([string]$Selector.name).ToLowerInvariant())) { return $false }
    }
    if ($Selector.automationId -and $automationId -ine [string]$Selector.automationId) { return $false }
    if ($Selector.controlType -and $controlType -ine ([string]$Selector.controlType).Replace("ControlType.", "")) { return $false }
    if ($Selector.className -and !$className.ToLowerInvariant().Contains(([string]$Selector.className).ToLowerInvariant())) { return $false }
    return $true
  } catch {
    return $false
  }
}

function Get-ControlTypeObject([string]$Name) {
  switch ($Name.Replace("ControlType.", "").Trim().ToLowerInvariant()) {
    "button" { return [System.Windows.Automation.ControlType]::Button }
    "calendar" { return [System.Windows.Automation.ControlType]::Calendar }
    "checkbox" { return [System.Windows.Automation.ControlType]::CheckBox }
    "combobox" { return [System.Windows.Automation.ControlType]::ComboBox }
    "document" { return [System.Windows.Automation.ControlType]::Document }
    "edit" { return [System.Windows.Automation.ControlType]::Edit }
    "hyperlink" { return [System.Windows.Automation.ControlType]::Hyperlink }
    "image" { return [System.Windows.Automation.ControlType]::Image }
    "list" { return [System.Windows.Automation.ControlType]::List }
    "listitem" { return [System.Windows.Automation.ControlType]::ListItem }
    "menu" { return [System.Windows.Automation.ControlType]::Menu }
    "menuitem" { return [System.Windows.Automation.ControlType]::MenuItem }
    "pane" { return [System.Windows.Automation.ControlType]::Pane }
    "radiobutton" { return [System.Windows.Automation.ControlType]::RadioButton }
    "tab" { return [System.Windows.Automation.ControlType]::Tab }
    "tabitem" { return [System.Windows.Automation.ControlType]::TabItem }
    "text" { return [System.Windows.Automation.ControlType]::Text }
    "tree" { return [System.Windows.Automation.ControlType]::Tree }
    "treeitem" { return [System.Windows.Automation.ControlType]::TreeItem }
    "window" { return [System.Windows.Automation.ControlType]::Window }
    default { return $null }
  }
}

function Get-FastControlCondition($Selector) {
  if (!$Selector) { return $null }
  if ($Selector.automationId) {
    return New-Object System.Windows.Automation.PropertyCondition(
      [System.Windows.Automation.AutomationElement]::AutomationIdProperty,
      [string]$Selector.automationId
    )
  }
  if ($Selector.controlType) {
    $controlType = Get-ControlTypeObject ([string]$Selector.controlType)
    if ($controlType) {
      return New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
        $controlType
      )
    }
  }
  return $null
}

function Get-MatchingControls($Window, $Selector, [int]$MaxResults = 120) {
  $matches = New-Object System.Collections.Generic.List[object]
  $items = New-Object System.Collections.Generic.List[object]
  $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
  $queue = New-Object System.Collections.Queue
  $first = $walker.GetFirstChild($Window.Element)
  if ($first) { $queue.Enqueue([pscustomobject]@{ Element = $first; Depth = 1 }) }
  $scanned = 0
  $scanLimit = [Math]::Max(500, [Math]::Min(3500, $MaxResults * 20))
  while ($queue.Count -gt 0 -and $scanned -lt $scanLimit) {
    $node = $queue.Dequeue()
    $items.Add($node.Element)
    $scanned += 1
    if ($node.Depth -lt 9) {
      $child = $walker.GetFirstChild($node.Element)
      if ($child) { $queue.Enqueue([pscustomobject]@{ Element = $child; Depth = $node.Depth + 1 }) }
    }
    $sibling = $walker.GetNextSibling($node.Element)
    if ($sibling) { $queue.Enqueue([pscustomobject]@{ Element = $sibling; Depth = $node.Depth }) }
  }
  $matchIndex = 0
  foreach ($item in $items.ToArray()) {
    if (!(Test-ControlSelector $item $Selector)) { continue }
    $record = Get-ControlRecord $item $matchIndex
    if ($record) {
      $matches.Add([pscustomobject]@{ Element = $item; Record = $record })
      $matchIndex += 1
      if ($matches.Count -ge [Math]::Max(1, $MaxResults)) { break }
    }
  }
  return $matches.ToArray()
}

function Find-Control($Window, $Selector) {
  $matches = @(Get-MatchingControls $Window $Selector 500)
  if (!$matches.Count) { throw "没有找到匹配的界面控件" }
  $requestedIndex = if ($null -ne $Selector.index) { [Math]::Max(0, [int]$Selector.index) } else { 0 }
  if ($requestedIndex -ge $matches.Count) { throw "匹配控件数量不足，无法使用索引 $requestedIndex" }
  return $matches[$requestedIndex]
}

function Set-MatchedControlText($Match, [string]$Text) {
  if (!$Match) { throw "没有找到可输入文字的控件" }
  if ($Match.Record.isPassword) { throw "不能向安全输入控件自动写入内容" }
  try { [void]$Match.Element.SetFocus() } catch { }
  Start-Sleep -Milliseconds 100
  $pattern = $null
  if ($Match.Element.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$pattern)) {
    $valuePattern = [System.Windows.Automation.ValuePattern]$pattern
    if (!$valuePattern.Current.IsReadOnly) {
      $valuePattern.SetValue($Text)
      return [pscustomobject]@{ method = "value"; control = $Match.Record; characters = $Text.Length }
    }
  }
  Set-ClipboardText $Text
  [void](Send-NamedKeys "CTRL+V")
  return [pscustomobject]@{ method = "clipboard"; control = $Match.Record; characters = $Text.Length }
}

function Invoke-ElementClick($Element) {
  $pattern = $null
  if ($Element.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$pattern)) {
    try {
      ([System.Windows.Automation.InvokePattern]$pattern).Invoke()
      return "invoke"
    } catch { }
  }
  $pattern = $null
  if ($Element.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern, [ref]$pattern)) {
    try {
      ([System.Windows.Automation.SelectionItemPattern]$pattern).Select()
      return "select"
    } catch { }
  }
  $pattern = $null
  if ($Element.TryGetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern, [ref]$pattern)) {
    try {
      ([System.Windows.Automation.TogglePattern]$pattern).Toggle()
      return "toggle"
    } catch { }
  }
  try {
    $controlHandle = [IntPtr]([int]$Element.Current.NativeWindowHandle)
    if ($controlHandle -ne [IntPtr]::Zero) {
      [void][XianmaDesktopNative]::SendMessage($controlHandle, 0x00F5, [IntPtr]::Zero, [IntPtr]::Zero)
      Start-Sleep -Milliseconds 120
      return "win32-message"
    }
  } catch { }
  try {
    [void]$Element.SetFocus()
    Start-Sleep -Milliseconds 100
    if ([bool]$Element.Current.HasKeyboardFocus) {
      [System.Windows.Forms.SendKeys]::SendWait(" ")
      Start-Sleep -Milliseconds 120
      return "keyboard-space"
    }
  } catch { }
  $rect = $Element.Current.BoundingRectangle
  if ($rect.Width -le 0 -or $rect.Height -le 0) { throw "控件没有可点击区域" }
  $x = [int]($rect.X + ($rect.Width / 2))
  $y = [int]($rect.Y + ($rect.Height / 2))
  [void][XianmaDesktopNative]::SetCursorPos($x, $y)
  [XianmaDesktopNative]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
  [XianmaDesktopNative]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
  return "mouse"
}

function Get-WindowBounds($Window) {
  $rect = New-Object XianmaDesktopNative+RECT
  if (![XianmaDesktopNative]::GetWindowRect([IntPtr]$Window.Handle, [ref]$rect)) { throw "无法读取应用窗口位置" }
  $width = [Math]::Max(1, $rect.Right - $rect.Left)
  $height = [Math]::Max(1, $rect.Bottom - $rect.Top)
  return [pscustomobject]@{ x = $rect.Left; y = $rect.Top; width = $width; height = $height }
}

function Click-WindowPosition($Window, [double]$XRatio, [double]$YRatio) {
  $bounds = Get-WindowBounds $Window
  $safeXRatio = [Math]::Max(0.05, [Math]::Min(0.95, $XRatio))
  $safeYRatio = [Math]::Max(0.05, [Math]::Min(0.95, $YRatio))
  $x = [int]($bounds.x + ($bounds.width * $safeXRatio))
  $y = [int]($bounds.y + ($bounds.height * $safeYRatio))
  [void][XianmaDesktopNative]::SetCursorPos($x, $y)
  [XianmaDesktopNative]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
  [XianmaDesktopNative]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 120
  return [pscustomobject]@{ x = $x; y = $y; xRatio = $safeXRatio; yRatio = $safeYRatio }
}

function Set-WindowPositionText($Window, [double]$XRatio, [double]$YRatio, [string]$Text) {
  $position = Click-WindowPosition $Window $XRatio $YRatio
  try {
    $point = New-Object System.Windows.Point([double]$position.x, [double]$position.y)
    $element = [System.Windows.Automation.AutomationElement]::FromPoint($point)
    if ($element) {
      $record = Get-ControlRecord $element 0
      if ($record -and !$record.isPassword) {
        $matched = [pscustomobject]@{ Element = $element; Record = $record }
        $result = Set-MatchedControlText $matched $Text
        return [pscustomobject]@{ method = "position-$($result.method)"; position = $position; control = $record; characters = $Text.Length }
      }
    }
  } catch {
    if ($_.Exception.Message -match "安全输入控件") { throw }
  }
  Set-ClipboardText $Text
  [void](Send-NamedKeys "CTRL+V")
  return [pscustomobject]@{ method = "position-clipboard"; position = $position; characters = $Text.Length }
}

function Copy-WindowBitmap($Window) {
  $bounds = Get-WindowBounds $Window
  if ($bounds.x -lt -10000 -or $bounds.y -lt -10000) { throw "应用窗口当前不可见" }
  $lastError = $null
  for ($attempt = 0; $attempt -lt 4; $attempt += 1) {
    $capture = New-Object System.Drawing.Bitmap($bounds.width, $bounds.height)
    $graphics = [System.Drawing.Graphics]::FromImage($capture)
    try {
      $graphics.CopyFromScreen($bounds.x, $bounds.y, 0, 0, $capture.Size)
      return [pscustomobject]@{ bitmap = $capture; bounds = $bounds }
    } catch {
      $lastError = $_
      $deviceContext = [IntPtr]::Zero
      try {
        $deviceContext = $graphics.GetHdc()
        $printed = [XianmaDesktopNative]::PrintWindow([IntPtr]$Window.Handle, $deviceContext, 2)
      } catch {
        $lastError = $_
        $printed = $false
      } finally {
        if ($deviceContext -ne [IntPtr]::Zero) { $graphics.ReleaseHdc($deviceContext) }
      }
      if ($printed) { return [pscustomobject]@{ bitmap = $capture; bounds = $bounds } }
      $capture.Dispose()
      if ($attempt -lt 3) { Start-Sleep -Milliseconds (150 * ($attempt + 1)) }
    } finally {
      $graphics.Dispose()
    }
  }
  throw "无法截取应用窗口：$($lastError.Exception.Message)"
}

function Get-WindowFingerprint($Window) {
  $windowCapture = Copy-WindowBitmap $Window
  $capture = $windowCapture.bitmap
  try {
    $sample = New-Object System.Drawing.Bitmap(64, 36)
    $sampleGraphics = [System.Drawing.Graphics]::FromImage($sample)
    try {
      $sampleGraphics.DrawImage($capture, 0, 0, 64, 36)
      $values = New-Object System.Collections.Generic.List[int]
      for ($y = 0; $y -lt 36; $y += 1) {
        for ($x = 0; $x -lt 64; $x += 1) {
          $pixel = $sample.GetPixel($x, $y)
          $values.Add([int](($pixel.R + $pixel.G + $pixel.B) / 3))
        }
      }
      return $values.ToArray()
    } finally {
      $sampleGraphics.Dispose()
      $sample.Dispose()
    }
  } finally { $capture.Dispose() }
}

function Save-WindowCapture($Window, [string]$TargetPath) {
  if (!$TargetPath) { throw "缺少截图保存路径" }
  $directory = Split-Path -Parent $TargetPath
  if ($directory) { [void](New-Item -ItemType Directory -Path $directory -Force) }
  $windowCapture = Copy-WindowBitmap $Window
  $capture = $windowCapture.bitmap
  try {
    $capture.Save($TargetPath, [System.Drawing.Imaging.ImageFormat]::Png)
  } finally { $capture.Dispose() }
  return [pscustomobject]@{ path = $TargetPath; width = $windowCapture.bounds.width; height = $windowCapture.bounds.height }
}

function Get-FingerprintDifference($Before, $After) {
  if (!$Before -or !$After -or $Before.Count -ne $After.Count -or !$Before.Count) { return 0.0 }
  $difference = 0.0
  for ($index = 0; $index -lt $Before.Count; $index += 1) {
    $difference += [Math]::Abs([double]$Before[$index] - [double]$After[$index]) / 255.0
  }
  return $difference / $Before.Count
}

function Set-ClipboardText([string]$Text) {
  $lastError = $null
  for ($attempt = 0; $attempt -lt 6; $attempt += 1) {
    try {
      [System.Windows.Forms.Clipboard]::SetText($Text)
      return
    } catch {
      $lastError = $_
      Start-Sleep -Milliseconds 120
    }
  }
  throw "无法写入系统剪贴板：$($lastError.Exception.Message)"
}

function Send-NamedKeys([string]$Keys) {
  $normalized = ([string]$Keys).Trim().ToUpperInvariant().Replace(" ", "")
  $mapping = @{
    "CTRL+A" = "^a"; "CTRL+C" = "^c"; "CTRL+V" = "^v"; "CTRL+X" = "^x"
    "CTRL+F" = "^f"; "CTRL+K" = "^k"; "CTRL+L" = "^l"; "CTRL+S" = "^s"
    "CTRL+N" = "^n"; "CTRL+O" = "^o"; "CTRL+P" = "^p"; "CTRL+T" = "^t"; "CTRL+W" = "^w"
    "CTRL+Z" = "^z"; "CTRL+Y" = "^y"; "CTRL+B" = "^b"; "CTRL+I" = "^i"
    "CTRL+ENTER" = "^{ENTER}"; "ALT+S" = "%s"; "ALT+F4" = "%{F4}"
    "ENTER" = "{ENTER}"; "TAB" = "{TAB}"; "SHIFT+TAB" = "+{TAB}"; "SPACE" = " "
    "ESC" = "{ESC}"; "ESCAPE" = "{ESC}"
    "UP" = "{UP}"; "DOWN" = "{DOWN}"; "LEFT" = "{LEFT}"; "RIGHT" = "{RIGHT}"
    "BACKSPACE" = "{BACKSPACE}"; "DELETE" = "{DELETE}"; "HOME" = "{HOME}"; "END" = "{END}"
    "PAGEUP" = "{PGUP}"; "PAGEDOWN" = "{PGDN}"; "F1" = "{F1}"; "F2" = "{F2}"
    "F3" = "{F3}"; "F4" = "{F4}"; "F5" = "{F5}"; "F6" = "{F6}"; "F7" = "{F7}"
    "F8" = "{F8}"; "F9" = "{F9}"; "F10" = "{F10}"; "F11" = "{F11}"; "F12" = "{F12}"
  }
  if (!$mapping.ContainsKey($normalized)) { throw "不支持的快捷键：$Keys" }
  $shell = New-Object -ComObject WScript.Shell
  $shell.SendKeys($mapping[$normalized])
  Start-Sleep -Milliseconds 120
  return $normalized
}

function Invoke-BrowserNavigate([string]$AppName, [string]$Url, [bool]$NewTab, [int]$WaitMs, [string]$CapturePath, [string]$ProfilePath, [int]$WindowHandle, [int]$RemoteDebugPort) {
  if ([string]::IsNullOrWhiteSpace($Url)) { throw "缺少要打开的网址" }
  if ($Url -notmatch "^(https?|file):") { throw "只允许打开 http、https 或本地 file 地址" }

  $terms = @(Get-AppTerms $AppName)
  $matchesBrowser = {
    param($candidateWindow)
    $search = "$($candidateWindow.ProcessName) $($candidateWindow.ProcessPath) $($candidateWindow.Title)".ToLowerInvariant()
    return ($terms | Where-Object { $_ -and $search.Contains($_.ToLowerInvariant()) }).Count -gt 0
  }
  $beforeWindows = @(Get-WindowElements | Where-Object { & $matchesBrowser $_ })
  $beforeTitles = @{}
  foreach ($beforeWindow in $beforeWindows) { $beforeTitles[[string]$beforeWindow.Handle] = [string]$beforeWindow.Title }

  $window = if ($WindowHandle -gt 0) { Find-AppWindow $AppName $WindowHandle } else { $null }
  $initialTitle = if ($window) { [string]$window.Title } else { "" }
  $navigatedExisting = $false
  if ($window) {
    if ($RemoteDebugPort -le 0) {
      [void](Focus-AppWindow $window)
      [void](Send-NamedKeys "CTRL+L")
      Set-ClipboardText $Url
      [void](Send-NamedKeys "CTRL+V")
      [void](Send-NamedKeys "ENTER")
    }
    $navigatedExisting = $true
  }

  $openedByExecutable = $false
  if (!$navigatedExisting -and ![string]::IsNullOrWhiteSpace($ProfilePath)) {
    [void](New-Item -ItemType Directory -Path $ProfilePath -Force)
    $executable = @(Get-CommonExecutableCandidates $AppName) | Select-Object -First 1
    if (!$executable) { $executable = Find-InstalledExecutable $AppName }
    if (!$executable) { throw "没有找到可用的 Microsoft Edge 或 Google Chrome" }
    $arguments = @("--user-data-dir=$ProfilePath", "--no-first-run", "--disable-extensions")
    if ($RemoteDebugPort -gt 0) { $arguments += "--remote-debugging-port=$RemoteDebugPort" }
    $arguments += @("--new-window", $Url)
    [void](Start-Process -FilePath $executable -ArgumentList $arguments -PassThru)
    $openedByExecutable = $true
  } elseif (!$navigatedExisting -and $NewTab) {
    $executable = @(Get-CommonExecutableCandidates $AppName) | Select-Object -First 1
    if (!$executable) { $executable = Find-InstalledExecutable $AppName }
    if ($executable) {
      [void](Start-Process -FilePath $executable -ArgumentList @("--new-tab", $Url) -PassThru)
      $openedByExecutable = $true
    }
  }

  if (!$openedByExecutable -and !$navigatedExisting) {
    $launch = Start-App $AppName ([Math]::Max(1000, $WaitMs))
    if (!$launch.window -or !$launch.window.handle) { throw "浏览器已启动，但没有检测到可操作窗口" }
    $window = Find-AppWindow $AppName ([int]$launch.window.handle)
    if (!$window) { throw "没有找到浏览器窗口" }
    $initialTitle = [string]$window.Title
    [void](Focus-AppWindow $window)
    [void](Send-NamedKeys "CTRL+L")
    Set-ClipboardText $Url
    [void](Send-NamedKeys "CTRL+V")
    [void](Send-NamedKeys "ENTER")
  }

  $deadline = [DateTime]::UtcNow.AddMilliseconds([Math]::Max(2500, $WaitMs))
  $changedAt = $null
  $addressNavigationApplied = $false
  do {
    Start-Sleep -Milliseconds 350
    if ($openedByExecutable) {
      $currentWindows = @(Get-WindowElements | Where-Object { & $matchesBrowser $_ })
      $foregroundHandle = [int][XianmaDesktopNative]::GetForegroundWindow()
      $newWindows = @($currentWindows | Where-Object { !$beforeTitles.ContainsKey([string]$_.Handle) })
      $changedWindows = @($currentWindows | Where-Object {
        !$beforeTitles.ContainsKey([string]$_.Handle) -or $beforeTitles[[string]$_.Handle] -ne [string]$_.Title
      })
      $window = $newWindows | Where-Object { $_.Handle -eq $foregroundHandle } | Select-Object -First 1
      if (!$window) { $window = $newWindows | Where-Object { $_.Title } | Select-Object -First 1 }
      if (!$window) { $window = $changedWindows | Where-Object { $_.Handle -eq $foregroundHandle } | Select-Object -First 1 }
      if (!$window) { $window = $changedWindows | Where-Object { $_.Title } | Select-Object -First 1 }
      if (!$window) { $window = $currentWindows | Where-Object { $_.Handle -eq $foregroundHandle } | Select-Object -First 1 }
      if (!$window) { $window = $currentWindows | Where-Object { $_.Title } | Select-Object -First 1 }
      if ($window -and [string]$window.Title) {
        if (![string]::IsNullOrWhiteSpace($ProfilePath) -and $RemoteDebugPort -le 0 -and !$addressNavigationApplied) {
          [void](Focus-AppWindow $window)
          [void](Send-NamedKeys "CTRL+L")
          Set-ClipboardText $Url
          [void](Send-NamedKeys "CTRL+V")
          [void](Send-NamedKeys "ENTER")
          $initialTitle = [string]$window.Title
          $addressNavigationApplied = $true
          $changedAt = $null
          continue
        }
        $previousTitle = if ($beforeTitles.ContainsKey([string]$window.Handle)) { $beforeTitles[[string]$window.Handle] } else { "" }
        $comparisonTitle = if ($addressNavigationApplied) { $initialTitle } else { $previousTitle }
        if ([string]$window.Title -ne $comparisonTitle) {
          if ($null -eq $changedAt) { $changedAt = [DateTime]::UtcNow }
          if (([DateTime]::UtcNow - $changedAt).TotalMilliseconds -ge 900) { break }
        }
      }
    } else {
      $current = Find-AppWindow $AppName ([int]$window.Handle)
      if ($current) {
        $window = $current
        if ([string]$window.Title -and [string]$window.Title -ne $initialTitle) {
          if ($null -eq $changedAt) { $changedAt = [DateTime]::UtcNow }
          if (([DateTime]::UtcNow - $changedAt).TotalMilliseconds -ge 900) { break }
        }
      }
    }
  } while ([DateTime]::UtcNow -lt $deadline)

  if (!$window) { throw "浏览器窗口在导航过程中不可用" }
  [void](Focus-AppWindow $window)
  $capture = $null
  if (![string]::IsNullOrWhiteSpace($CapturePath)) {
    $capture = Save-WindowCapture $window $CapturePath
  }
  return [pscustomobject]@{
    navigated = $true
    url = $Url
    title = [string]$window.Title
    window = Convert-WindowRecord $window
    capture = $capture
  }
}

function Set-ControlText($Window, $Selector, [string]$Text) {
  $match = $null
  if ($Selector -and ($Selector.name -or $Selector.automationId -or $Selector.controlType -or $Selector.className)) {
    $match = Find-Control $Window $Selector
  } else {
    $editSelector = [pscustomobject]@{ controlType = "Edit"; contains = $true }
    $candidates = @(Get-MatchingControls $Window $editSelector 200 | Where-Object { $_.Record.isEnabled -and !$_.Record.isOffscreen })
    if (!$candidates.Count) {
      $documentSelector = [pscustomobject]@{ controlType = "Document"; contains = $true }
      $candidates = @(Get-MatchingControls $Window $documentSelector 200 | Where-Object { $_.Record.isEnabled -and !$_.Record.isOffscreen })
    }
    if (!$candidates.Count) { throw "没有找到可输入文字的控件" }
    $match = $candidates | Sort-Object @{ Expression = { $_.Record.bounds.y }; Descending = $true }, @{ Expression = { $_.Record.bounds.width }; Descending = $true } | Select-Object -First 1
  }

  return Set-MatchedControlText $match $Text
}

function Get-ControlText($Window, $Selector) {
  $match = Find-Control $Window $Selector
  if ($match.Record.isPassword) { throw "安全输入控件的内容不可读取" }
  $pattern = $null
  if ($match.Element.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$pattern)) {
    return [pscustomobject]@{ method = "value"; control = $match.Record; text = ([System.Windows.Automation.ValuePattern]$pattern).Current.Value }
  }
  $pattern = $null
  if ($match.Element.TryGetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern, [ref]$pattern)) {
    return [pscustomobject]@{ method = "text"; control = $match.Record; text = ([System.Windows.Automation.TextPattern]$pattern).DocumentRange.GetText(20000) }
  }
  return [pscustomobject]@{ method = "name"; control = $match.Record; text = $match.Record.name }
}

function Get-MessageEditor($Window) {
  $controls = @()
  foreach ($controlType in @("Edit", "Document")) {
    $selector = [pscustomobject]@{ controlType = $controlType; contains = $true }
    $controls += @(Get-MatchingControls $Window $selector 300 | Where-Object {
      $_.Record.isEnabled -and !$_.Record.isOffscreen -and $_.Record.bounds.width -ge 180 -and $_.Record.bounds.height -ge 24
    })
  }
  if (!$controls.Count) { return $null }
  return $controls | Sort-Object @{ Expression = { $_.Record.bounds.y }; Descending = $true }, @{ Expression = { $_.Record.bounds.width }; Descending = $true } | Select-Object -First 1
}

function Get-SearchEditor($Window) {
  $controls = @()
  foreach ($controlType in @("Edit", "Document")) {
    $selector = [pscustomobject]@{ controlType = $controlType; contains = $true }
    $controls += @(Get-MatchingControls $Window $selector 300 | Where-Object {
      $_.Record.isEnabled -and !$_.Record.isOffscreen -and $_.Record.bounds.width -ge 120 -and $_.Record.bounds.height -ge 20
    })
  }
  if (!$controls.Count) { return $null }
  $named = @($controls | Where-Object { $_.Record.name -match "搜索|查找|Search|Find" })
  if ($named.Count) { return $named | Sort-Object @{ Expression = { $_.Record.bounds.y } } | Select-Object -First 1 }
  return $controls | Sort-Object @{ Expression = { $_.Record.bounds.y } }, @{ Expression = { $_.Record.bounds.width }; Descending = $true } | Select-Object -First 1
}

function Prepare-Message([string]$AppName, [string]$Contact, [string]$Message, [int]$WaitMs = 15000) {
  if (!$Contact.Trim()) { throw "缺少消息接收人" }
  if (!$Message) { throw "缺少消息内容" }
  $launch = Start-App $AppName $WaitMs
  $window = if ($launch.window) { Find-AppWindow $AppName ([int]$launch.window.handle) } else { Find-AppWindow $AppName 0 }
  if (!$window) { throw "应用已启动，但没有找到可操作窗口" }
  [void](Focus-AppWindow $window)
  $terms = @(Get-AppTerms $AppName)
  $isWechat = ($terms -contains "wechat") -or ($terms -contains "weixin")
  $isFeishu = ($terms -contains "feishu") -or ($terms -contains "lark")
  $usesKnownChatWorkflow = $isWechat -or $isFeishu
  $beforeSearch = Get-WindowFingerprint $window
  if ($isWechat) { [void](Send-NamedKeys "CTRL+F") }
  elseif ($isFeishu) { [void](Send-NamedKeys "CTRL+K") }
  else { [void](Send-NamedKeys "CTRL+F") }
  Start-Sleep -Milliseconds 650
  $window = Find-AppWindow $AppName $window.Handle
  if (!$window) { throw "打开搜索后应用窗口不可用" }
  $afterSearch = Get-WindowFingerprint $window
  $searchDifference = Get-FingerprintDifference $beforeSearch $afterSearch
  if ($usesKnownChatWorkflow) {
    if ($searchDifference -lt 0.001) { throw "没有确认联系人搜索界面已经打开，未输入或发送任何内容" }
    [void](Send-NamedKeys "CTRL+A")
    Set-ClipboardText $Contact
    [void](Send-NamedKeys "CTRL+V")
  } else {
    $searchEditor = Get-SearchEditor $window
    if (!$searchEditor) { throw "没有检测到联系人搜索框，未输入或发送任何内容" }
    [void](Set-MatchedControlText $searchEditor $Contact)
  }
  Start-Sleep -Milliseconds 900
  $beforeSelect = Get-WindowFingerprint $window
  [void](Send-NamedKeys "ENTER")
  Start-Sleep -Milliseconds 900

  $window = Find-AppWindow $AppName $window.Handle
  if (!$window) { throw "选择联系人后应用窗口不可用" }
  [void](Focus-AppWindow $window)
  $afterSelect = Get-WindowFingerprint $window
  $selectDifference = Get-FingerprintDifference $beforeSelect $afterSelect
  if ($usesKnownChatWorkflow) {
    if ($selectDifference -lt 0.001) { throw "没有确认已进入目标会话，未填写或发送消息" }
    $beforeDraft = Get-WindowFingerprint $window
    [void](Click-WindowPosition $window 0.66 0.82)
    Set-ClipboardText $Message
    [void](Send-NamedKeys "CTRL+V")
    Start-Sleep -Milliseconds 350
    $afterDraft = Get-WindowFingerprint $window
    $draftDifference = Get-FingerprintDifference $beforeDraft $afterDraft
    if ($draftDifference -lt 0.0001) { throw "没有确认消息已填入输入框，未执行发送" }
  } else {
    $editor = Get-MessageEditor $window
    if (!$editor) { throw "没有检测到消息输入框，未执行发送" }
    try { [void](Invoke-ElementClick $editor.Element) } catch { }
    [void](Set-MatchedControlText $editor $Message)
  }
  return [pscustomobject]@{
    prepared = $true
    app = $AppName
    contact = $Contact
    messageLength = $Message.Length
    window = Convert-WindowRecord $window
    targetVerified = $false
    notice = "消息已填入输入区但尚未发送，请在确认弹窗中核对接收人和内容。"
  }
}

function Send-PreparedMessage([string]$AppName, [int]$WindowHandle) {
  $window = Find-AppWindow $AppName $WindowHandle
  if (!$window) { throw "消息窗口已关闭或发生变化，未执行发送" }
  [void](Focus-AppWindow $window)
  $terms = @(Get-AppTerms $AppName)
  $isWechat = ($terms -contains "wechat") -or ($terms -contains "weixin")
  $isFeishu = ($terms -contains "feishu") -or ($terms -contains "lark")
  if ($isWechat -or $isFeishu) {
    $beforeSend = Get-WindowFingerprint $window
    if ($isWechat) { [void](Send-NamedKeys "ALT+S") } else { [void](Send-NamedKeys "ENTER") }
    Start-Sleep -Milliseconds 500
    $afterSend = Get-WindowFingerprint $window
    $difference = Get-FingerprintDifference $beforeSend $afterSend
    return [pscustomobject]@{
      sent = $difference -ge 0.0001
      method = if ($isWechat) { "alt-s" } else { "enter" }
      verifiedByUiChange = $difference -ge 0.0001
      window = Convert-WindowRecord $window
    }
  }
  $buttonCandidates = @()
  foreach ($name in @("发送", "发送(S)", "Send")) {
    $selector = [pscustomobject]@{ name = $name; controlType = "Button"; contains = $true }
    $buttonCandidates += @(Get-MatchingControls $window $selector 20 | Where-Object { $_.Record.isEnabled -and !$_.Record.isOffscreen })
  }
  if ($buttonCandidates.Count) {
    $button = $buttonCandidates | Sort-Object @{ Expression = { $_.Record.bounds.y }; Descending = $true } | Select-Object -First 1
    $method = Invoke-ElementClick $button.Element
    return [pscustomobject]@{ sent = $true; method = "button-$method"; window = Convert-WindowRecord $window }
  }
  [void](Send-NamedKeys "ENTER")
  return [pscustomobject]@{ sent = $true; method = "enter"; window = Convert-WindowRecord $window }
}

try {
  $payloadJson = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($PayloadBase64))
  $payload = $payloadJson | ConvertFrom-Json
  $action = ([string]$payload.action).Trim().ToLowerInvariant()
  switch ($action) {
    "list_apps" {
      $query = [string]$payload.query
      $terms = @(Get-AppTerms $query)
      $windows = @(Get-WindowElements | Where-Object {
        if (!$query) { return $true }
        $search = "$($_.ProcessName) $($_.ProcessPath) $($_.Title)".ToLowerInvariant()
        return ($terms | Where-Object { $_ -and $search.Contains($_.ToLowerInvariant()) }).Count -gt 0
      } | ForEach-Object { Convert-WindowRecord $_ })
      $startApps = @(Get-StartApps -ErrorAction SilentlyContinue | Where-Object {
        if (!$query) { return $true }
        $name = ([string]$_.Name).ToLowerInvariant()
        return ($terms | Where-Object { $_ -and $name.Contains($_.ToLowerInvariant()) }).Count -gt 0
      } | Select-Object -First 200 | ForEach-Object { [pscustomobject]@{ name = $_.Name; appId = $_.AppID } })
      Write-Result ([pscustomobject]@{ ok = $true; windows = $windows; installedApps = $startApps })
    }
    "launch" {
      $result = Start-App ([string]$payload.app) (Get-IntegerOrDefault $payload.waitMs 15000)
      Write-Result ([pscustomobject]@{ ok = $true; result = $result })
    }
    "browser_navigate" {
      $result = Invoke-BrowserNavigate ([string]$payload.app) ([string]$payload.url) ([bool]$payload.newTab) (Get-IntegerOrDefault $payload.waitMs 15000) ([string]$payload.path) ([string]$payload.profilePath) (Get-IntegerOrDefault $payload.windowHandle 0) (Get-IntegerOrDefault $payload.remoteDebugPort 0)
      Write-Result ([pscustomobject]@{ ok = $true; result = $result })
    }
    "inspect" {
      $window = Find-AppWindow ([string]$payload.app) (Get-IntegerOrDefault $payload.windowHandle 0)
      if (!$window) { throw "没有找到应用窗口" }
      $matches = @(Get-MatchingControls $window $payload.selector (Get-IntegerOrDefault $payload.maxResults 120))
      Write-Result ([pscustomobject]@{
        ok = $true
        window = Convert-WindowRecord $window
        controls = @($matches | ForEach-Object { $_.Record })
      })
    }
    "capture" {
      $window = Find-AppWindow ([string]$payload.app) (Get-IntegerOrDefault $payload.windowHandle 0)
      if (!$window) { throw "没有找到应用窗口" }
      [void](Focus-AppWindow $window)
      $capture = Save-WindowCapture $window ([string]$payload.path)
      Write-Result ([pscustomobject]@{ ok = $true; capture = $capture; window = Convert-WindowRecord $window })
    }
    "focus" {
      $window = Find-AppWindow ([string]$payload.app) (Get-IntegerOrDefault $payload.windowHandle 0)
      Write-Result ([pscustomobject]@{ ok = $true; window = Focus-AppWindow $window })
    }
    "click" {
      $window = Find-AppWindow ([string]$payload.app) (Get-IntegerOrDefault $payload.windowHandle 0)
      if (!$window) { throw "没有找到应用窗口" }
      [void](Focus-AppWindow $window)
      $control = Find-Control $window $payload.selector
      $method = Invoke-ElementClick $control.Element
      Write-Result ([pscustomobject]@{ ok = $true; clicked = $true; method = $method; control = $control.Record; window = Convert-WindowRecord $window })
    }
    "click_position" {
      $window = Find-AppWindow ([string]$payload.app) (Get-IntegerOrDefault $payload.windowHandle 0)
      if (!$window) { throw "没有找到应用窗口" }
      [void](Focus-AppWindow $window)
      $position = Click-WindowPosition $window ([double]$payload.xRatio) ([double]$payload.yRatio)
      Write-Result ([pscustomobject]@{ ok = $true; clicked = $true; method = "relative-position"; position = $position; window = Convert-WindowRecord $window })
    }
    "set_text" {
      $window = Find-AppWindow ([string]$payload.app) (Get-IntegerOrDefault $payload.windowHandle 0)
      if (!$window) { throw "没有找到应用窗口" }
      [void](Focus-AppWindow $window)
      if ($null -ne $payload.xRatio -and $null -ne $payload.yRatio) {
        $result = Set-WindowPositionText $window ([double]$payload.xRatio) ([double]$payload.yRatio) ([string]$payload.text)
      } else {
        $result = Set-ControlText $window $payload.selector ([string]$payload.text)
      }
      Write-Result ([pscustomobject]@{ ok = $true; result = $result; window = Convert-WindowRecord $window })
    }
    "read_text" {
      $window = Find-AppWindow ([string]$payload.app) (Get-IntegerOrDefault $payload.windowHandle 0)
      if (!$window) { throw "没有找到应用窗口" }
      $result = Get-ControlText $window $payload.selector
      Write-Result ([pscustomobject]@{ ok = $true; result = $result; window = Convert-WindowRecord $window })
    }
    "hotkey" {
      $window = Find-AppWindow ([string]$payload.app) (Get-IntegerOrDefault $payload.windowHandle 0)
      if (!$window) { throw "没有找到应用窗口" }
      [void](Focus-AppWindow $window)
      $keys = Send-NamedKeys ([string]$payload.keys)
      Write-Result ([pscustomobject]@{ ok = $true; keys = $keys; window = Convert-WindowRecord $window })
    }
    "prepare_message" {
      $result = Prepare-Message ([string]$payload.app) ([string]$payload.contact) ([string]$payload.message) (Get-IntegerOrDefault $payload.waitMs 15000)
      Write-Result ([pscustomobject]@{ ok = $true; result = $result })
    }
    "send_message" {
      $result = Send-PreparedMessage ([string]$payload.app) ([int]$payload.windowHandle)
      Write-Result ([pscustomobject]@{ ok = $true; result = $result })
    }
    default { throw "不支持的桌面自动化操作：$action" }
  }
} catch {
  Write-Result ([pscustomobject]@{
    ok = $false
    error = $_.Exception.Message
    line = $_.InvocationInfo.ScriptLineNumber
    operation = ([string]$payload.action)
  })
  exit 1
}
