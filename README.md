# zwubhi.github.io

Portfolio of Subhitcha Senthilvel, geospatial and data science graduate in Brisbane.

Live site: https://zwubhi.github.io

## What's here

- `index.html`: all page content
- `css/style-v2.css`: styles, including Day (light) and Night (dark) themes
- `js/main-v2.js`: the interactive parts, in plain JavaScript with no libraries
  - Brisbane bus service map drawn from GeoJSON (pan, zoom, click or search to zoom to a suburb, three shading layers)
  - projects globe with a Moon mode
  - experience transit line that follows scrolling
  - skills shown as toggleable map layers
- `data/`: GeoJSON exported from [brisbane-bus-service-deficit](https://github.com/zwubhi/brisbane-bus-service-deficit)
  (GDA2020 MGA56 reprojected to WGS 84, boundaries simplified at 15 m, coordinates at 5 decimal places)
- `images/`: static map fallback and social preview image

## Edit and preview

Edit the text in `index.html`. To preview locally (the maps need a local server):

```
python -m http.server 8000
```

Then open http://localhost:8000.
