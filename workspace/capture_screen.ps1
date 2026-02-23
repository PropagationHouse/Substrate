Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

# Define the coordinates for the second screen (Index 1) based on previous WMI/Forms output
$screenLeft = 3840
$screenTop = 0
$screenWidth = 3840  # Standard 4K width
$screenHeight = 2160

$bitmap = New-Object System.Drawing.Bitmap $screenWidth, $screenHeight
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)

# Copy from the screen at the specified offset
$graphics.CopyFromScreen($screenLeft, $screenTop, 0, 0, $bitmap.Size)

# Save to the workspace directory
$bitmap.Save("C:\Users\Bl0ck\Desktop\TPXGO\workspace\display2_manual.jpg", [System.Drawing.Imaging.ImageFormat]::Jpeg)

$graphics.Dispose()
$bitmap.Dispose()
