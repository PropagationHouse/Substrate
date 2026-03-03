; Substrate NSIS Installer Hooks
; Runs after installation to create necessary directories

!macro customInstall
  CreateDirectory "$INSTDIR\profiles"
  CreateDirectory "$INSTDIR\knowledge"
  CreateDirectory "$INSTDIR\workspace"
  CreateDirectory "$INSTDIR\data"
  CreateDirectory "$INSTDIR\logs"
  CreateDirectory "$INSTDIR\uploads"
  CreateDirectory "$INSTDIR\screenshots"
  CreateDirectory "$INSTDIR\config"
  CreateDirectory "$INSTDIR\skills"
  CreateDirectory "$INSTDIR\certs"
!macroend
