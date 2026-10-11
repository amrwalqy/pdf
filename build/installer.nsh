!macro customUnInstall
  DetailPrint "Cleaning up Alif PDF registry associations..."
  DeleteRegKey HKCU "Software\Classes\Alif.PDF"
  DeleteRegKey HKCU "Software\Alif"
  DeleteRegValue HKCU "Software\RegisteredApplications" "Alif"
  DeleteRegValue HKCU "Software\Classes\.pdf\OpenWithProgids" "Alif.PDF"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.pdf\OpenWithProgids" "Alif.PDF"
!macroend
