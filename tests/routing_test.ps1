$A = '29.0615,40.1842'
$B = '29.0628,40.1848'

$urls = @{
    'OSRM_Project_Car' = "https://router.project-osrm.org/route/v1/driving/$A;$B?overview=full&geometries=geojson&steps=true"
    'OSM_DE_Foot'     = "https://routing.openstreetmap.de/routed-foot/route/v1/driving/$A;$B?overview=full&geometries=geojson&steps=true"
    'OSM_DE_Bike'     = "https://routing.openstreetmap.de/routed-bike/route/v1/driving/$A;$B?overview=full&geometries=geojson&steps=true"
    'OSM_DE_Car'      = "https://routing.openstreetmap.de/routed-car/route/v1/driving/$A;$B?overview=full&geometries=geojson&steps=true"
}

foreach ($name in $urls.Keys) {
    Write-Host "--- $name ---"
    try {
        $resp = Invoke-WebRequest -Uri $urls[$name] -UseBasicParsing
        $resp.Content | Out-File -FilePath "D:/projeler/konum-degistirme/tests/$name.json"
        Write-Host "Success: $name"
    } catch {
        Write-Host "Error calling $name : $_"
    }
}
