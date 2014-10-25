# importing new regions

1) get KML file (if starting from KMZ, use Google Earth to save as KML)

2) do the postgis shape simplification flow, to reduce shape complexity

first, in the "postgis" database:
set search_path to public;

check number of points output:
SELECT ST_NPoints(ST_SimplifyPreserveTopology(ST_GeomFromKML('
KML_fragment_here
		'), 0.01));

get KML:
SELECT ST_AsKML(ST_SimplifyPreserveTopology(ST_GeomFromKML('
KML_fragment_here
		'), 0.01));

3) edit and run KMLtoJSON.js

4) edit and run trimDigits.js (optimize file size)

5) add to regions.json

6) then, go add forecast handling
