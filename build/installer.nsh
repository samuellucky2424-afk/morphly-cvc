!include LogicLib.nsh
!include nsDialogs.nsh

!macro customHeader
!macroend

!ifndef BUILD_UNINSTALLER
Var VBCableInstallCheckbox
Var VBCableInstallSelected
Var VBCableDetected
Var VBCableInstallExitCode

Function DetectVBCable
  StrCpy $VBCableDetected "0"
  nsExec::ExecToStack `powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$$pattern = 'VB-Audio|VB-CABLE|VB Cable|Voicemeeter|CABLE Input|CABLE Output'; $$devices = Get-CimInstance Win32_PnPEntity -ErrorAction SilentlyContinue | Where-Object { $$_.Name -match $$pattern -or $$_.Manufacturer -match $$pattern }; $$soundDevices = Get-CimInstance Win32_SoundDevice -ErrorAction SilentlyContinue | Where-Object { $$_.Name -match $$pattern -or $$_.Manufacturer -match $$pattern }; $$paths = @('HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*','HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*','HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*'); $$apps = $$paths | ForEach-Object { Get-ItemProperty $$_ -ErrorAction SilentlyContinue } | Where-Object { $$_.DisplayName -match $$pattern -or $$_.Publisher -match $$pattern }; if ($$devices -or $$soundDevices -or $$apps) { exit 0 } exit 1"`
  Pop $0
  Pop $1
  ${If} $0 == "0"
    StrCpy $VBCableDetected "1"
  ${EndIf}
FunctionEnd

Function VBCableOptionsPage
  Call DetectVBCable

  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0 0 100% 38u "Stream Mode needs a virtual audio driver so Zoom, WhatsApp, Telegram, YouTube, OBS, and other apps can receive Morphly as a microphone. Leave this checked to install it with Morphly."
  Pop $1

  ${If} $VBCableDetected == "1"
    StrCpy $VBCableInstallSelected "0"
    ${NSD_CreateCheckbox} 0 48u 100% 14u "Repair or reinstall VB-CABLE virtual audio driver"
  ${Else}
    StrCpy $VBCableInstallSelected "1"
    ${NSD_CreateCheckbox} 0 48u 100% 14u "Install VB-CABLE virtual audio driver for Morphly Stream Mode"
  ${EndIf}
  Pop $VBCableInstallCheckbox

  ${If} $VBCableInstallSelected == "1"
    ${NSD_Check} $VBCableInstallCheckbox
  ${Else}
    ${NSD_Uncheck} $VBCableInstallCheckbox
  ${EndIf}

  ${NSD_CreateLabel} 0 70u 100% 58u "VB-CABLE is made by VB-Audio / Vincent Burel and is donationware. Morphly bundles the official package as-is for easier setup. Continuing with the option checked acknowledges this notice. Windows may still show a driver consent dialog, and a restart may be required before Stream Mode detects the cable."
  Pop $2

  ${NSD_CreateLink} 0 132u 100% 12u "VB-Audio licensing and donationware information"
  Pop $3
  ${NSD_OnClick} $3 OpenVBCableLicensing

  nsDialogs::Show
FunctionEnd

Function VBCableOptionsPageLeave
  ${NSD_GetState} $VBCableInstallCheckbox $VBCableInstallSelected
FunctionEnd

Function OpenVBCableLicensing
  ExecShell "open" "https://vb-audio.com/Services/licensing.htm"
FunctionEnd

!macro customPageAfterChangeDir
  Page custom VBCableOptionsPage VBCableOptionsPageLeave
!macroend

!macro InstallVBCable
  ${If} $VBCableInstallSelected == ${BST_CHECKED}
    DetailPrint "Preparing VB-CABLE virtual audio driver installer"
    InitPluginsDir
    SetOutPath "$PLUGINSDIR\MorphlyVBCABLE"
    File /r "${BUILD_RESOURCES_DIR}\vendor\vbcable\*.*"

    IfFileExists "$PLUGINSDIR\MorphlyVBCABLE\VBCABLE_Setup_x64.exe" 0 vbcable_installer_missing
    DetailPrint "Installing VB-CABLE virtual audio driver. Windows may show a driver consent dialog."
    ExecWait '"$PLUGINSDIR\MorphlyVBCABLE\VBCABLE_Setup_x64.exe" -i -h' $VBCableInstallExitCode
    DetailPrint "VB-CABLE installer exit code: $VBCableInstallExitCode"
    ${If} $VBCableInstallExitCode != "0"
      DetailPrint "VB-CABLE setup did not report success. Stream Mode may need repair from Morphly setup."
    ${EndIf}
    Goto vbcable_installer_done
    vbcable_installer_missing:
    DetailPrint "VB-CABLE installer file was not found in bundled resources."
    vbcable_installer_done:
  ${Else}
    DetailPrint "Skipping VB-CABLE driver installation"
  ${EndIf}
!macroend

!macro customInstall
  DetailPrint "Configuring Windows firewall rule for Morphly local services"
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="Morphly Voice Console" dir=in action=allow program="$INSTDIR\${APP_EXECUTABLE_FILENAME}" enable=yes profile=private,domain'

  !insertmacro InstallVBCable
  MessageBox MB_ICONINFORMATION|MB_OK "Morphly setup is complete.$\r$\n$\r$\nIf VB-CABLE was installed or repaired, restart Windows before using Stream Mode if the virtual cable does not appear immediately."
!macroend
!endif

!ifdef BUILD_UNINSTALLER
!macro customUnInstall
  DetailPrint "Removing Windows firewall rule for Morphly local services"
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="Morphly Voice Console"'
  DetailPrint "Leaving VB-CABLE installed because other apps may depend on it"
!macroend
!endif
