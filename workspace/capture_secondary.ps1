Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$x = 3840
$y = 0
$width = 3840
$height = 2160

$bmp = New-Object System.Drawing.Bitmap $width, $height
$graphics = [System.Drawing.Graphics]::FromImage($bmp)

$graphics.CopyFromScreen($x, $y, 0, 0, $bmp.Size)

$bmp.Save("display2_manual.jpg", [System.Drawing.Imaging.ImageFormat]::Jpeg)

$graphics.Dispose()
$bmp.Dispose()
Write-Output "Captured secondary display to display2_manual.jpg"