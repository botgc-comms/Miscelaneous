param(
    [switch]$Execute,
    [string]$Date = "21-09-2026",
    [int]$Course = 22,
    [string]$TargetTime = "19:10",
    [string]$PlayerName = "Seth Parsons",
    [string]$ExpectedGroupTitle = "Test group booking"
)

$ErrorActionPreference = "Stop"

Write-Host "SCRIPT VERSION: Test group-slot replacement v2 - 2026-09-21"
Write-Host ""

$base = "https://www.botgc.co.uk"
$temp = Join-Path $env:TEMP ("botgc-group-slot-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $temp | Out-Null

$cookieJar = Join-Path $temp "cookies.txt"
$loginHtml = Join-Path $temp "login.html"
$loginPostHtml = Join-Path $temp "login-post.html"
$beforeHtml = Join-Path $temp "before.html"
$postHtml = Join-Path $temp "post.html"
$afterHtml = Join-Path $temp "after.html"

function Invoke-CurlGet {
    param(
        [Parameter(Mandatory=$true)][string]$Url,
        [Parameter(Mandatory=$true)][string]$OutFile
    )

    & curl.exe --ssl-no-revoke -sS -L `
        -b $cookieJar -c $cookieJar `
        -A "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36 Edg/152.0.0.0" `
        -o $OutFile `
        -w "%{http_code}`n%{url_effective}" `
        $Url
}

function Invoke-CurlPost {
    param(
        [Parameter(Mandatory=$true)][string]$Url,
        [Parameter(Mandatory=$true)][string]$OutFile,
        [Parameter(Mandatory=$true)][hashtable]$Fields
    )

    $args = @(
        "--ssl-no-revoke",
        "-sS",
        "-L",
        "-b", $cookieJar,
        "-c", $cookieJar,
        "-A", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36 Edg/152.0.0.0",
        "-H", "X-Requested-With: XMLHttpRequest",
        "-H", "Accept: */*",
        "-o", $OutFile,
        "-w", "%{http_code}`n%{url_effective}"
    )

    foreach ($k in $Fields.Keys) {
        $args += "--data-urlencode"
        $args += ("{0}={1}" -f $k, [string]$Fields[$k])
    }

    $args += $Url
    & curl.exe @args
}

function Get-HiddenInputs {
    param([string]$Html)

    $result = @{}
    $matches = [regex]::Matches(
        $Html,
        '<input\b(?=[^>]*\btype\s*=\s*["'']?hidden["'']?)[^>]*>',
        [System.Text.RegularExpressions.RegexOptions]::IgnoreCase
    )

    foreach ($m in $matches) {
        $tag = $m.Value
        $nm = [regex]::Match(
            $tag,
            '\bname\s*=\s*(?:"([^"]*)"|''([^'']*)''|([^\s>]+))',
            [System.Text.RegularExpressions.RegexOptions]::IgnoreCase
        )
        if (-not $nm.Success) { continue }

        $name = @($nm.Groups[1].Value,$nm.Groups[2].Value,$nm.Groups[3].Value) |
            Where-Object { $_ -ne "" } | Select-Object -First 1

        $vm = [regex]::Match(
            $tag,
            '\bvalue\s*=\s*(?:"([^"]*)"|''([^'']*)''|([^\s>]+))',
            [System.Text.RegularExpressions.RegexOptions]::IgnoreCase
        )

        $value = ""
        if ($vm.Success) {
            $value = @($vm.Groups[1].Value,$vm.Groups[2].Value,$vm.Groups[3].Value) |
                Where-Object { $_ -ne "" } | Select-Object -First 1
            if ($null -eq $value) { $value = "" }
        }

        $result[$name] = [System.Net.WebUtility]::HtmlDecode($value)
    }

    return $result
}

function Strip-Html {
    param([string]$Html)
    $x = [regex]::Replace($Html, '<script\b[^>]*>.*?</script>', ' ', 'IgnoreCase,Singleline')
    $x = [regex]::Replace($x, '<style\b[^>]*>.*?</style>', ' ', 'IgnoreCase,Singleline')
    $x = [regex]::Replace($x, '<[^>]+>', ' ')
    $x = [System.Net.WebUtility]::HtmlDecode($x)
    $x = [regex]::Replace($x, '\s+', ' ')
    return $x.Trim()
}

function Get-TimeRow {
    param(
        [string]$Html,
        [string]$Time
    )

    $pattern = '<tr\b[^>]*>.*?<th\b[^>]*class=(?:"[^"]*\bslot-time\b[^"]*"|''[^'']*\bslot-time\b[^'']*'')[^>]*>\s*' +
               [regex]::Escape($Time) +
               '\s*</th>.*?</tr>'

    $m = [regex]::Match(
        $Html,
        $pattern,
        [System.Text.RegularExpressions.RegexOptions]::IgnoreCase -bor
        [System.Text.RegularExpressions.RegexOptions]::Singleline
    )

    if ($m.Success) { return $m.Value }
    return $null
}

function Show-RowSummary {
    param(
        [string]$Label,
        [string]$Html,
        [string]$Time
    )

    Write-Host ""
    Write-Host "=== $Label ==="
    $row = Get-TimeRow -Html $Html -Time $Time

    if (-not $row) {
        Write-Host "Could not locate the $Time row."
        return
    }

    $plain = Strip-Html $row
    Write-Host $plain

    $ids = [regex]::Matches($row, 'id=["'']tt_(\d+)["'']', 'IgnoreCase') |
        ForEach-Object { $_.Groups[1].Value }

    $block = [regex]::Match($row, 'data-block-booking-id=["'']?(\d+)["'']?', 'IgnoreCase')

    Write-Host ("Slot IDs         : {0}" -f ($ids -join ", "))
    Write-Host ("Block booking ID : {0}" -f $(if ($block.Success) { $block.Groups[1].Value } else { "<none>" }))
    Write-Host ("Contains player  : {0}" -f ($plain.IndexOf($PlayerName, [System.StringComparison]::OrdinalIgnoreCase) -ge 0))
    Write-Host ("Still group slot : {0}" -f ($row -match '\btgroup\b'))
}

# Login
$memberId = Read-Host "Intelligent Golf member ID"
$pinSecure = Read-Host "Intelligent Golf PIN" -AsSecureString
$pin = [System.Net.NetworkCredential]::new("", $pinSecure).Password

$null = Invoke-CurlGet "$base/login.php" $loginHtml
if ($LASTEXITCODE -ne 0) { throw "Initial login GET failed." }

$loginText = Get-Content $loginHtml -Raw
$fields = Get-HiddenInputs $loginText
$fields["memberid"] = $memberId
$fields["pin"] = $pin
$fields["task"] = "login"
$fields["topmenu"] = "1"
$fields["cachemid"] = "1"
$fields["Submit"] = "Login"

$null = Invoke-CurlPost "$base/login.php" $loginPostHtml $fields
if ($LASTEXITCODE -ne 0) { throw "Login POST failed." }

$loginPostText = Get-Content $loginPostHtml -Raw
if ($loginPostText -match '<title>\s*Login Required\b') {
    throw "Authentication failed."
}

Write-Host "Authenticated with Intelligent Golf."

$teeUrl = "$base/teetimes.php?date=$Date&course=$Course&group=1"
$null = Invoke-CurlGet $teeUrl $beforeHtml
if ($LASTEXITCODE -ne 0) { throw "Could not load tee sheet." }

$before = Get-Content $beforeHtml -Raw
$row = Get-TimeRow -Html $before -Time $TargetTime
if (-not $row) { throw "Could not find target row $TargetTime." }

$slotIds = [regex]::Matches($row, 'id=["'']tt_(\d+)["'']', 'IgnoreCase') |
    ForEach-Object { [int]$_.Groups[1].Value }

$blockMatch = [regex]::Match($row, 'data-block-booking-id=["'']?(\d+)["'']?', 'IgnoreCase')
if (-not $blockMatch.Success) {
    throw "$TargetTime is not currently marked as a group/block booking."
}

$actualBlockId = [int]$blockMatch.Groups[1].Value

Show-RowSummary -Label "BEFORE" -Html $before -Time $TargetTime

Write-Host ""
if ($slotIds.Count -lt 1) {
    throw "Safety stop: no live tee-slot ID was found for $TargetTime."
}

$TargetSlotId = [int]$slotIds[0]
$rowPlain = Strip-Html $row

Write-Host "Live first slot ID     : $TargetSlotId"
Write-Host "Live block booking ID  : $actualBlockId"
Write-Host "Expected group title   : $ExpectedGroupTitle"

if ($rowPlain.IndexOf($ExpectedGroupTitle, [System.StringComparison]::OrdinalIgnoreCase) -lt 0) {
    throw "Safety stop: $TargetTime is a group/block row, but it does not contain the expected title '$ExpectedGroupTitle'."
}

if ($row -notmatch '\btgroup\b') {
    throw "Safety stop: $TargetTime is no longer marked as a group booking slot."
}

Write-Host "Safety check           : live $TargetTime row belongs to the expected group booking."

if (-not $Execute) {
    Write-Host ""
    Write-Host "NO POST SENT."
    Write-Host "The live test will use the CURRENT slot ID as bookingid=$TargetSlotId for the $TargetTime first player slot."
    Write-Host "Rerun with -Execute to perform the test."
    Write-Host ""
    Write-Host "Diagnostics: $temp"
    exit 0
}

Write-Host ""
Write-Host "=== LIVE TEST REQUEST ==="
Write-Host "POST $base/teetimes.php"
Write-Host "bookingtime=$TargetTime"
Write-Host "course=$Course"
Write-Host "date=$Date"
Write-Host "bookingslots=1"
Write-Host "numholes=9"
Write-Host "comments="
Write-Host "greenfee=0"
Write-Host "bookingname=$PlayerName"
Write-Host "nocontact=1"
Write-Host "bookingid=$TargetSlotId"
Write-Host "button_pressed=Proceed Anyway"
Write-Host ""
Write-Host "This uses the slot ID read live from the current $TargetTime row. The group/block ID is used only as a safety check."
$confirm = Read-Host "Type YES to send this one live POST"
if ($confirm -ne "YES") {
    Write-Host "Cancelled."
    exit 0
}

$postFields = @{
    bookingtime    = $TargetTime
    course         = $Course
    date           = $Date
    bookingslots   = "1"
    numholes       = "9"
    comments       = ""
    greenfee       = "0"
    bookingname    = $PlayerName
    nocontact      = "1"
    bookingid      = [string]$TargetSlotId
    button_pressed = "Proceed Anyway"
}

$postMeta = Invoke-CurlPost "$base/teetimes.php" $postHtml $postFields
if ($LASTEXITCODE -ne 0) { throw "Booking POST failed at curl level." }

Write-Host ""
Write-Host "=== POST RESPONSE ==="
Write-Host $postMeta

$postBody = Get-Content $postHtml -Raw
if ($postBody.Length -lt 2000) {
    Write-Host (Strip-Html $postBody)
}
else {
    $postText = Strip-Html $postBody
    Write-Host ($postText.Substring(0, [Math]::Min(1800, $postText.Length)))
}

$null = Invoke-CurlGet $teeUrl $afterHtml
if ($LASTEXITCODE -ne 0) { throw "Could not reload tee sheet." }

$after = Get-Content $afterHtml -Raw
Show-RowSummary -Label "AFTER" -Html $after -Time $TargetTime

$afterRow = Get-TimeRow -Html $after -Time $TargetTime
$afterPlain = if ($afterRow) { Strip-Html $afterRow } else { "" }

Write-Host ""
if ($afterPlain.IndexOf($PlayerName, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) {
    Write-Host "RESULT: SUCCESS - $PlayerName now appears in the $TargetTime row."
    if ($afterRow -match '\btgroup\b') {
        Write-Host "The row still contains group-booking cells as well."
    }
    else {
        Write-Host "The group reservation appears to have been converted/consumed for that row."
    }
}
else {
    Write-Host "RESULT: $PlayerName does not appear in the $TargetTime row."
    Write-Host "The POST response above is the next clue."
}

Write-Host ""
Write-Host "Diagnostics: $temp"
