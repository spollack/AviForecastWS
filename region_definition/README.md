# importing new regions

1) get KML file (if starting from KMZ, use Google Earth to save as KML)

2) do the postgis shape simplification flow, to reduce shape complexity

-- first, in the "postgis" database:
set search_path to public;

-- get the KML; KML_fragment_here is the full contents of the Polygon tag for the placemark
SELECT ST_AsKML(ST_SimplifyPreserveTopology(ST_GeomFromKML('
KML_fragment_here
		'), 0.01));

3) edit and run KMLtoJSON.js

4) edit and run trimDigits.js (to optimize file size)

5) add to regions.json

6) then, go add forecast handling
