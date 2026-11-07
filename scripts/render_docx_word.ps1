param(
    [Parameter(Mandatory = $true)][string]$InputDocx,
    [Parameter(Mandatory = $true)][string]$OutputDir,
    [int]$StartPage = 1,
    [int]$EndPage = 0
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
$word = New-Object -ComObject Word.Application
$word.Visible = $false
$word.DisplayAlerts = 0

try {
    $document = $word.Documents.Open($InputDocx, $false, $true)
    $document.Repaginate()
    $pageCount = $document.ComputeStatistics(2)
    if ($EndPage -le 0 -or $EndPage -gt $pageCount) {
        $EndPage = $pageCount
    }

    for ($page = $StartPage; $page -le $EndPage; $page++) {
        $start = $document.GoTo(1, 1, $page).Start
        if ($page -lt $pageCount) {
            $end = $document.GoTo(1, 1, $page + 1).Start - 1
        } else {
            $end = $document.Content.End
        }
        $range = $document.Range($start, $end)
        $range.CopyAsPicture()
        $image = $null
        for ($attempt = 1; $attempt -le 12 -and $null -eq $image; $attempt++) {
            Start-Sleep -Milliseconds 350
            try {
                if ([System.Windows.Forms.Clipboard]::ContainsImage()) {
                    $image = [System.Windows.Forms.Clipboard]::GetImage()
                }
            } catch {
                if ($attempt -eq 12) { throw }
            }
        }
        if ($null -eq $image) {
            throw "Clipboard did not contain an image for page $page"
        }
        $path = Join-Path $OutputDir ('page-{0:D2}.png' -f $page)
        try {
            $image.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
        } finally {
            $image.Dispose()
        }
        [System.Windows.Forms.Clipboard]::Clear()
        Write-Output $path
    }

    $document.Close($false)
    Write-Output "PAGE_COUNT=$pageCount"
} finally {
    $word.Quit()
    [System.Runtime.InteropServices.Marshal]::ReleaseComObject($word) | Out-Null
}
