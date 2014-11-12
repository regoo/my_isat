/*global document, window, setInterval, Cesium, Image, navigator, twoline2rv, sgp4, tle, gstime*/
(function () {
    'use strict';
    var canvas                  = document.getElementById('glCanvas');
    var ellipsoid               = Cesium.Ellipsoid.WGS84;
    var scene                   = new Cesium.Scene(canvas);
    var satBillboards           = new Cesium.BillboardCollection();
    var cb                      = new Cesium.CentralBody(ellipsoid);
    var orbitTraces             = new Cesium.PolylineCollection(); // currently only one at a time
    var satrecs                 = [];   // populated from onclick file load
    var satPositions            = [];   // calculated by updateSatrecsPosVel()
    var satData                 = [];   // list of satellite data and metadata
    var selectedSatelliteIdx    = null;

    // Constants
    var CESIUM_TEXTURES_BASE    = 'media/sot/cesium/Assets/Textures';
    var SKYBOX_BASE             = CESIUM_TEXTURES_BASE + '/SkyBox';
    var CALC_INTERVAL_MS        = 1000;

    // HACK: force globals for SGP4
    var WHICHCONST              = 72;   //
    var TYPERUN                 = 'm';  // 'm'anual, 'c'atalog, 'v'erification
    var TYPEINPUT               = 'n';  // HACK: 'now'
    var PLAY                    = true;

    // Global Variables for URL
    var ORIGINAL_GROUP = 'SMD';
    var ORIGINAL_SATELLITE = 'null';

    // Dictionary of Map tile providers for Cesium
    var TILE_PROVIDERS = {
        'bing': new Cesium.BingMapsImageryProvider({
            url: 'http://dev.virtualearth.net',
            mapStyle: Cesium.BingMapsStyle.AERIAL_WITH_LABELS
        }),
        'osm': new Cesium.OpenStreetMapImageryProvider({
            url: 'http://otile1.mqcdn.com/tiles/1.0.0/osm'
        }),
        'static': new Cesium.SingleTileImageryProvider({
            url: CESIUM_TEXTURES_BASE + '/NE2_LR_LC_SR_W_DR_2048.jpg'
        }),
        // Lots of ArcGIS products avaiable including .../World_Street_Map/MapServer
        // TODO: for now use AGI's proxy but we need to run our own to avoid:
        // "Cross-origin image load denied by Cross-Origin Resource Sharing policy."
        'arcgis': new Cesium.ArcGisMapServerImageryProvider({
            url: 'http://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer',
            proxy: new Cesium.DefaultProxy('http://cesiumjs.org/proxy/')
        })
    };

    function checkURLVariables() {

        // Function to find the current variables in the URL for permalinks.
        function loadURIVariables(qs){
            // This function is anonymous, is executed immediately and
            // the return value is assigned to QueryString!
            var query_string = {};
            var query = window.location.search.substring(1);
            var vars = query.split("&");
            for (var i=0;i<vars.length;i++) {
                var pair = vars[i].split("=");
                    // If first entry with this name
                if (typeof query_string[pair[0]] === "undefined") {
                    query_string[pair[0]] = pair[1];
                    // If second entry with this name
                } else if (typeof query_string[pair[0]] === "string") {
                    var arr = [ query_string[pair[0]], pair[1] ];
                    query_string[pair[0]] = arr;
                    // If third or later entry with this name
                } else {
                    query_string[pair[0]].push(pair[1]);
                }
            }
            return query_string;
        }

        var query = window.location.search.substring(1);
        var variables = loadURIVariables(query);

        if (variables.group !== undefined) {
            ORIGINAL_GROUP = variables.group;
        }

        if (variables.satellite !== undefined) {
            ORIGINAL_SATELLITE = variables.satellite;
        }
    }

    // Function to get all basic views set on load.
    (function () {
        checkURLVariables();

        // How do we tell if we can't get Bing, and substitute flat map with 'single'?
        cb.imageryLayers.addImageryProvider(TILE_PROVIDERS.bing); // TODO: get from HTML selector

        scene.primitives.centralBody = cb;
        scene.skyAtmosphere = new Cesium.SkyAtmosphere(); // make globe stand out from skybox
        scene.skyBox = new Cesium.SkyBox({
            sources : {
                positiveX: SKYBOX_BASE + '/tycho2t3_80_px.jpg',
                negativeX: SKYBOX_BASE + '/tycho2t3_80_mx.jpg',
                positiveY: SKYBOX_BASE + '/tycho2t3_80_py.jpg',
                negativeY: SKYBOX_BASE + '/tycho2t3_80_my.jpg',
                positiveZ: SKYBOX_BASE + '/tycho2t3_80_pz.jpg',
                negativeZ: SKYBOX_BASE + '/tycho2t3_80_mz.jpg'
            }
        });
        scene.primitives.add(orbitTraces);

        ////////////////////////
        // This should first see if there's a satellite in url, if not, check for geolocation, else default.
        //

        if(ORIGINAL_SATELLITE === 'null'){
            showGeolocation(scene);
        }

        document.getElementById('select_satellite_group').value = ORIGINAL_GROUP;
        // document.getElementById('select_satellite').value = ORIGINAL_SATELLITE;
        getSatrecsFromTLEFile(document.getElementById('select_satellite_group').value);
        populateSatelliteSelector();
        populateSatelliteBillboard();
        satelliteHoverDisplay(scene); // should be self-invoked
        satelliteClickDetails(scene); // should be self-invoked
    }());

    ///////////////////////////////////////////////////////////////////////////
    // Satellite records and calculation

    // Read TLEs from file and set GLOBAL satrecs, names, noradId and intlDesig.
    // We can then run the SGP4 propagator over it and render as billboards.

    function getSatrecsFromTLEFile(fileName) {
        var satnum, max, rets, satrec, startmfe, stopmfe, deltamin;

        fileName = 'media/sot/tle/' + fileName + '.txt';
        var tles = tle.parseFile(fileName);

        // Reset the globals
        satrecs = [];
        satData = [];

        for (satnum = 0, max = tles.length; satnum < max; satnum += 1) {
            satData[satnum] = {
                name:      tles[satnum][0].trim(), // Name: (ISS (ZARYA))
                intlDesig: tles[satnum][1].slice(9, 17), // Intl Designator YYNNNPPP (98067A)
                noradId:   tles[satnum][2].split(' ')[1], // NORAD ID (25544)
                // should parse and store the bits we want, but save string for now
                tle0: tles[satnum][0],
                tle1: tles[satnum][1],
                tle2: tles[satnum][2]
            };

            rets = twoline2rv(WHICHCONST,
                              tles[satnum][1],
                              tles[satnum][2],
                              TYPERUN,
                              TYPEINPUT);
            satrec   = rets.shift();
            startmfe = rets.shift();
            stopmfe  = rets.shift();
            deltamin = rets.shift();
            satrecs.push(satrec); // Don't need to sgp4(satrec, 0.0) to initialize state vector
        }
        // Returns nothing, sets globals: satrecs, satData
    }

    // Calculate new Satrecs based on time given as fractional Julian Date
    // (since that's what satrec stores).
    // Return object containing updated list of Satrecs, Rposition, Velocity.
    // We don't have r (position) or v (velocity) in the satrec,
    // so we have to return a those as a list as well; ugly.
    // XXX Should I just add position and velocity to the satrec objects?

    function updateSatrecsPosVel(satrecs, julianDate) {
        var satrecsOut = [];
        var positions = [];
        var velocities = [];
        var satnum, max, satrecTmp, jdSat, minutesSinceEpoch, rets, satrec, r, v;

        for (satnum = 0, max = satrecs.length; satnum < max; satnum += 1) {
            satrecTmp = satrecs[satnum];
            jdSat = new Cesium.JulianDate.fromTotalDays(satrecTmp.jdsatepoch);
            minutesSinceEpoch = jdSat.getMinutesDifference(julianDate);
            rets = sgp4(satrecs[satnum], minutesSinceEpoch);
            satrec = rets.shift();
            r = rets.shift();      // [1802,    3835,    5287] Km, not meters
            v = rets.shift();
            satrecsOut.push(satrec);
            positions.push(r);
            velocities.push(v);
        }

        // UPDATE GLOBAL SO OTHERS CAN USE IT (TODO: make this sane w.r.t. globals)
        satPositions = positions;
        return {'satrecs': satrecsOut,
                'positions': positions,
                'velocities': velocities};
    }

    // Update the location of each satellite in the billboard.
    // The calculated position is in Km but Cesium wants meters.
    // The satellite's icon (from TextureAtlas) and name are already set
    // by populateSatelliteBillboard().

    function updateSatelliteBillboards(satPositions) {
        var now = new Cesium.JulianDate();
        var posnum, max, pos, newpos, bb;

        satBillboards.modelMatrix =
            Cesium.Matrix4.fromRotationTranslation(
                Cesium.Transforms.computeTemeToPseudoFixedMatrix(now),
                Cesium.Cartesian3.ZERO
            );
        for (posnum = 0, max = satPositions.length; posnum < max; posnum += 1) {
            bb = satBillboards.get(posnum);
            pos = satPositions[posnum];
            newpos =  new Cesium.Cartesian3(pos[0] * 1000, pos[1] * 1000, pos[2] * 1000); // TODO multiplyByScalar(1000)
            bb.setPosition(newpos);
        }
    }

    // Load the satellite names and keys into the selector, sorted by name

    function populateSatelliteSelector() {
        var satSelect   = document.getElementById('select_satellite');
        var nameIdx     = {};
        var satnum, max, option, satkeys;

        for (satnum = 0, max = satrecs.length; satnum < max; satnum += 1) {
            nameIdx[satData[satnum].name] = satnum;
        }
        satkeys = Object.keys(nameIdx);
        satkeys.sort();
        satSelect.innerHTML = ''; // document.getElementById('select_satellite').empty();
        option = document.createElement('option');
        satSelect.appendChild(option); // first is empty to not select any satellite
        for (satnum = 0, max = satkeys.length; satnum < max; satnum += 1) {
            option = document.createElement('option');
            option.textContent = satkeys[satnum];
            option.value = nameIdx[satkeys[satnum]];
            satSelect.appendChild(option);
        }
    }

    // Create a new billboard for the satellites which are updated frequently.
    // These are placed in the global satellite billboard, replacing any old ones.
    // Keep it distict from other billboards, e.g., GeoLocation, that don't change.
    // We don't need to set position here to be actual, it'll be updated in the time-loop.
    // TODO: should this be combined with the populateSatelliteSelector()?

    function populateSatelliteBillboard() {
        var satnum, max, billboard;
        var image = new Image();

        satBillboards.removeAll(); // clear out the old ones
        for (satnum = 0, max = satData.length; satnum < max; satnum += 1) {
            billboard = satBillboards.add({imageIndex: 0,
                                           position: new Cesium.Cartesian3(0, 0, 0)}); // BOGUS position
            // attach names for mouse interaction
            // TODO: just attach satData[satnum] and let JS display the attrs it wants?
            billboard.satelliteName       = satData[satnum].name;
            billboard.satelliteNoradId    = satData[satnum].noradId;
            billboard.satelliteDesignator = satData[satnum].intlDesig;
            billboard.satelliteData       = satData[satnum];
            billboard.satelliteNum        = satnum;
        }
        scene.primitives.add(satBillboards);

        image.src = 'media/sot/images/Satellite.png';
        image.onload = function () {
            var textureAtlas = scene.context.createTextureAtlas({image: image}); // seems needed in onload()
            satBillboards.textureAtlas = textureAtlas;
        };
    }

    ///////////////////////////////////////////////////////////////////////////
    // Geo: put a cross where we are, if the browser is Geo-aware

    function showGeolocation(scene) {
        function showGeo(position) {
            var target = ellipsoid.cartographicToCartesian( // TODO: should this be 0, 0, 0 through Geolocation?
                Cesium.Cartographic.fromDegrees(position.coords.longitude, position.coords.latitude));
            var eye    = ellipsoid.cartographicToCartesian(
                Cesium.Cartographic.fromDegrees(position.coords.longitude, position.coords.latitude, 1e7));
            var up     = new Cesium.Cartesian3(0, 0, 1);
            // Put a cross where we are
            var image = new Image();
            image.src = 'media/sot/images/icon_geolocation.png';
            image.onload = function () {
                var billboards = new Cesium.BillboardCollection(); // how to make single?
                var textureAtlas = scene.context.createTextureAtlas({image: image});
                billboards.textureAtlas = textureAtlas;
                billboards.modelMatrix = Cesium.Transforms.eastNorthUpToFixedFrame(target);
                billboards.add({imageIndex: 0,
                                position: new Cesium.Cartesian3(0.0, 0.0, 0.0)});
                scene.primitives.add(billboards);
            };

            // Point the camera at us and position it directly above us
            scene.camera.controller.lookAt(eye, target, up);
        }
        if ('geolocation' in navigator) {
            navigator.geolocation.getCurrentPosition(showGeo);
        }
    }

    ///////////////////////////////////////////////////////////////////////////
    // Utilities

    // Convert TLE name to something science.nasa.gov might use in Mission URLs.
    // How do we handle reliably?
    // Note: doesn't adhere to Django slugify() naming.
    // * TOPEX/POSEIDON -> topex-poseidon
    // * HINODE (SOLAR-B) -> hinode

    function scienceSlugify(value) {
        value = value.trim().toLowerCase();
        value = value.split('(')[0].trim(); // remove anything in trailing parens
        value = value.replace('/', '-');    // topex/poseidon -> topex-poseidon
        value = value.replace(/[^\w\s\-]/, ''); // remove nonword, nonspace, nondash
        value = value.replace(/[\-\s]+/, '-'); // multiple spaces/dashes to a single dash
        return value;
    }

    // Function xyzKmFixed(pt, fix) {
    //     // Return string formatted for xyz scaled to Km, with fixed precision.
    //     return '(' +
    //         (pt.x / 1000.0).toFixed(fix) + ', ' +
    //         (pt.y / 1000.0).toFixed(fix) + ', ' +
    //         (pt.z / 1000.0).toFixed(fix) + ', ' +
    //         ')';
    // }

    ///////////////////////////////////////////////////////////////////////////
    // Handle UI events

    // If the screen is resized, set animation window to a square 95% of width,
    // which leaves some room for scrollbars (else you end up zooming).
    // In <canvas> tag our height and width can only be in pixels, not percent.
    // So wrap it in a div whose height/width we can query.

    function onResize() {

        function getScrollBarWidth() {
            var t = document.createElement('textarea');
            t.cols = 1;
            t.rows = 1;
            t.style.visibility='hidden';
            t.style.border='none';
            document.body.appendChild(t);
            var w = t.offsetWidth - t.clientWidth;
            document.body.removeChild (t);
            return w;
        }


        var width = window.innerWidth;
        var height = window.innerHeight;
        // var height = cc.scrollHeight;
        if (canvas.width === width && canvas.height === height) {
            return;
        }
        canvas.width = width;
        canvas.height = height;
        var cc = document.getElementById('cesiumContainer');
        cc.width = width;
        cc.height = height;
        scene.camera.frustum.aspectRatio = width / height;
    }
    window.addEventListener('resize', onResize, false);
    onResize();

    // When you hover over a satellite, show its name in a popup
    // Add offset of canvas and an approx height of icon/label to position properly.
    // TODO: make offset based on label text height so cursor doesn't occlude.
    // TODO: scene and ellipsoid are global so why pass them in?

    function satelliteHoverDisplay(scene) {
        var handler = new Cesium.ScreenSpaceEventHandler(scene.canvas);

        handler.setInputAction( // actionFunction, mouseEventType, eventModifierKey
            function (movement) {
                var pickedObject = scene.pick(movement.endPosition);
                var satDiv = document.getElementById('satellite_popup');
                var canvasTop = canvas.offsetTop;
                if (pickedObject && pickedObject.satelliteName) { // Only show satellite, not Geo marker
                    satDiv.textContent = pickedObject.satelliteName;
                    satDiv.style.left = movement.endPosition.x + 'px';
                    satDiv.style.top  = movement.endPosition.y + canvasTop - 50 + 'px'; // seems a bit high from mouse
                    satDiv.style.display = ''; // remove any 'none'
                    // The following used to work in <style> section, but stopped; why?
                    satDiv.style.position = 'absolute'; // vital to positioning near cursor
                    satDiv.className = 'modal';
                }
                else {
                    satDiv.style.display = 'none';
                }
            },
            Cesium.ScreenSpaceEventType.MOUSE_MOVE // MOVE, WHEEL, {LEFT|MIDDLE|RIGHT}_{CLICK|DOUBLE_CLICK|DOWN|UP}
        );
    }

    function calcLatLonAlt(time, position, satellite) {
        function fMod2p(x) {
            var i = 0;
            var ret_val = 0.0;
            var twopi = 2.0 * Math.PI;

            ret_val = x;
            i = parseInt(ret_val / twopi);
            ret_val -= i * twopi;

            if (ret_val < 0.0){
                ret_val += twopi;
            }


            return ret_val;
        }

        var r = 0.0,
            e2 = 0.0,
            phi = 0.0,
            c = 0.0,
            f = 3.35281066474748E-3,
            twopi = 6.28318530717958623,
            pio2 = 1.57079632679489656,
            pi = 3.14159265358979323,
            xkmper = 6378.137,
            rad2degree = 57.295;

        satellite.theta = Math.atan2(position[1],position[0]);
        satellite.lonInRads = fMod2p(satellite.theta - gstime(time));
        r = Math.sqrt(Math.pow(position[0], 2) + Math.pow(position[1], 2));
        e2 = f * (2 - f);
        satellite.latInRads = Math.atan2(position[2], r);

        do {
            phi = satellite.latInRads;
            c = 1 / Math.sqrt(1 - e2 * Math.pow(Math.sin(phi), 2));
            satellite.latInRads = Math.atan2((position[2] + xkmper * c * e2 * Math.sin(phi)), r);

        } while (Math.abs(satellite.latInRads - phi) >= 1E-10);

        satellite.alt = r / Math.cos(satellite.latInRads) - xkmper * c;

        if (satellite.latInRads > pio2) {
            satellite.latInRads -= twopi;
        }

        if (satellite.lonInRads > pi) {
            satellite.lonInRads = -twopi + satellite.lonInRads;
        }

        satellite.latInDegrees = satellite.latInRads * rad2degree;
        satellite.lonInDegrees = satellite.lonInRads * rad2degree;
    }

    function displayStats() {
        var satnum = selectedSatelliteIdx; // fixed number to test...
        var pos0, vel0, vel0Carte, latLonAlt, sats;

        var now = new Cesium.JulianDate(); // TODO> we'll want to base on tick and time-speedup
        if (satrecs.length > 0) {
            sats = updateSatrecsPosVel(satrecs, now); // TODO: sgp4 needs minutesSinceEpoch from timeclock
            satrecs = sats.satrecs;                   // propagate [GLOBAL]
        }
        document.getElementById('satellite_display').setAttribute("style", "display:block"); // show modal
        pos0 = sats.positions[satnum];                 // position of first satellite
        vel0 = sats.velocities[satnum];
        vel0Carte = new Cesium.Cartesian3(vel0[0], vel0[1], vel0[2]);
        var time = now.getJulianDayNumber() + now.getJulianTimeFraction();
        latLonAlt = calcLatLonAlt(time, satPositions[satnum], satrecs[satnum]);  // (time, position, satellite)
        document.getElementById('satellite_name').innerHTML = satData[satnum].name;
        document.getElementById('satellite_id').innerHTML = satData[satnum].noradId;
        ORIGINAL_SATELLITE = satData[satnum].noradId;
        var kmpers = Cesium.Cartesian3.magnitude(vel0Carte);
        var mpers = kmpers * 0.621371;
        document.getElementById('satellite_velocity_kms').innerHTML = kmpers.toFixed(3);
        document.getElementById('satellite_velocity_ms').innerHTML = mpers.toFixed(3);

        // Adding Lat/Lon to Satellite Display
        document.getElementById('satellite_latInDegrees').innerHTML = satrecs[satnum].latInDegrees.toFixed(3);
        document.getElementById('satellite_lonInDegrees').innerHTML = satrecs[satnum].lonInDegrees.toFixed(3);

        // Converting calculated Altitude to Miles and adding both (KM and M) to Satellite Display
        var heightkm = satrecs[satnum].alt;
        var heightm = heightkm * 0.621371;
        document.getElementById('satellite_height_km').innerHTML = heightkm.toFixed(3);
        document.getElementById('satellite_height_m').innerHTML = heightm.toFixed(3);

        // Adding URLs if group is SMD to Satellite Display.
        if (ORIGINAL_GROUP === 'SMD') {
            document.getElementById('smd_info').setAttribute('style', 'display:block');
            // Computing SMD URL and adding it to Satellite Display
            var scienceUrl = 'http://science.nasa.gov/missions/';
            scienceUrl +=  scienceSlugify(satData[satnum].name) + '/';
            document.getElementById('science_url').href = scienceUrl;

            // Computing NSSDC URL and adding it to Satellite Display
            var nssdcUrl = 'http://nssdc.gsfc.nasa.gov/nmc/spacecraftDisplay.do?id=';
            var century;
            if (Number(satData[satnum].intlDesig.slice(0, 2)) < 20) { // heuristic from JTrack3D source code
                century = '20';
            } else {
                century = '19';
            }
            nssdcUrl += century + satData[satnum].intlDesig.slice(0, 2) + '-' + satData[satnum].intlDesig.slice(2);
            document.getElementById('nssdc_url').href = nssdcUrl;
        } else {
            document.getElementById('smd_info').setAttribute('style', 'display:none');
        }
    }

    function changeURL() {
        if(ORIGINAL_SATELLITE == 'null') {
            window.history.replaceState(null, null, "?group="+ORIGINAL_GROUP);
        } else {
            window.history.replaceState(null, null, "?group="+ORIGINAL_GROUP+"&satellite="+ORIGINAL_SATELLITE);
        }
    }

    // Clicking a satellite opens a page to Sciencce and NSSDC details

    function satelliteClickDetails(scene) {
        var handler = new Cesium.ScreenSpaceEventHandler(scene.canvas);

        handler.setInputAction( function (click) {  // actionFunction, mouseEventType, eventModifierKey
                var pickedObject = scene.pick(click.position);

                if (pickedObject) {
                    if (typeof window !== 'undefined') {
                        selectedSatelliteIdx = pickedObject.primitive.satelliteNum;
                    }
                    moveCamera();
                    showOrbit();
                    displayStats();
                    changeURL();

                }
            },
            Cesium.ScreenSpaceEventType.LEFT_CLICK // MOVE, WHEEL, {LEFT|MIDDLE|RIGHT}_{CLICK|DOUBLE_CLICK|DOWN|UP}
        );
    }

    // Highlight satellite billboard when selector pulldown used;
    // open a new window (Pop Up) that shows Science.nasa.gov's info about it.
    //
    // We attach an attribute so we can detect any previously highlighted satellite.
    // Updates one of the global satBillboard elements, resets others.
    // The setColor changes icon wings from blue to green.
    // Maybe we should replace the icon by fiddling the textureAtlas index
    // but that would require more images in the textureAtlas.

    document.getElementById('select_satellite').onchange = function () {
        document.getElementById('satellite_form').setAttribute("style", "display:none");
        selectedSatelliteIdx = Number(this.value);
        displayStats();
        moveCamera();
        showOrbit();
        changeURL();
    };

    function moveCamera() {
        var satIdx = selectedSatelliteIdx;
        var target = Cesium.Cartesian3.ZERO;
        var up = new Cesium.Cartesian3(0, 0, 1);
        var billboard, bbnum, max, pos, eye;

        for (bbnum = 0, max = satBillboards.length; bbnum < max; bbnum += 1) {
            billboard = satBillboards.get(bbnum);
            if (billboard.hasOwnProperty('isSelected')) {
                delete billboard.isSelected;
                billboard.setColor({red: 1, blue: 1, green: 1, alpha: 1});
                billboard.setScale(1.0);
            }
            if (bbnum === satIdx) {
                billboard = satBillboards.get(satIdx);
                billboard.isSelected = true;
                billboard.setColor({red: 1, blue: 0, green: 1, alpha: 1});
                billboard.setScale(2.0);
                pos = billboard.getPosition(); // Cartesian3, but what coordinate system?
            }
        }

        if (scene.mode === Cesium.SceneMode.SCENE3D) {
            // TODO: *fly* to 'above' the satellite still looking at Earth
            // Transform to put me "over" satellite location.
            scene.camera.transform = Cesium.Matrix4.fromRotationTranslation(
                Cesium.Transforms.computeTemeToPseudoFixedMatrix(new Cesium.JulianDate()),
                Cesium.Cartesian3.ZERO);
            eye = new Cesium.Cartesian3.clone(pos);
            eye = Cesium.Cartesian3.multiplyByScalar(eye, 2);
            scene.camera.controller.lookAt(eye, target, up);
        }
    }


    // For the given satellite, calculate points for one orbit, starting 'now'
    // and create a polyline to visualize it.
    // It does this by copying the satrec then looping over it through time.
    //
    // TODO: How to find the satIdx on a CLICK event?
    // TODO: the position loop repeats much of updateSatrecsPosVel()
    //
    // The TLE.slice(52, 63) is Mean Motion, Revs per day, e.g., ISS=15.72125391
    // ISS (ZARYA)
    // 1 25544U 98067A   08264.51782528 - .00002182  00000-0 -11606-4 0  2927
    // 2 25544  51.6416 247.4627 0006703 130.5360 325.0288 15.72125391563537
    // We can invert that to get the time time we need for one rev.
    // But it's not our satrec, and we are't storing parsed TLEs.
    // satrec.no is TLE.slice(51,63) / xpdotp in radians/minute; it's manipulated by SGP4 but OK.
    // ISS no=0.06767671366760845
    // To get full 'circle' = 2*Pi => minutes/orbit = 2*Pi / satrec.no = 92.84 minutes for ISS
    // Compare with TLE 15.721.. revs/day:
    // 24 hr/day * 60 min/hr / 15.72125391 rev/day = 91.59574 minutes/rev -- close (enough?)

    function showOrbit() {
        var satIdx = selectedSatelliteIdx;
        var positions = [];
        var rs = [];
        var satrec = satrecs[satIdx];
        // var satrec;
        // for(var i = 0; i < satrecs.length; i++){
        //     if(satrecs[i]['satnum'] == ORIGINAL_SATELLITE){
        //         satrec = satrecs[i];
        //     }
        // }
        var jdSat = new Cesium.JulianDate.fromTotalDays(satrec.jdsatepoch);
        var now = new Cesium.JulianDate(); // TODO: we'll want to base on tick and time-speedup
        var minutesPerOrbit = 2 * Math.PI / satrec.no;
        var pointsPerOrbit = 144; // arbitrary: should be adaptive based on size (radius) of orbit
        var minutesPerPoint = minutesPerOrbit / pointsPerOrbit;
        var minutes, julianDate, minutesSinceEpoch, rets, r, position;

        orbitTraces.modelMatrix = Cesium.Matrix4.fromRotationTranslation(Cesium.Transforms.computeTemeToPseudoFixedMatrix(now),
                                                                         Cesium.Cartesian3.ZERO);

        for (minutes = 0; minutes <= minutesPerOrbit; minutes += minutesPerPoint) {
            julianDate = now.addMinutes(minutes);
            minutesSinceEpoch = jdSat.getMinutesDifference(julianDate);
            rets = sgp4(satrec, minutesSinceEpoch);
            satrec = rets.shift();
            r = rets.shift();      // [1802,    3835,    5287] Km, not meters
            position = new Cesium.Cartesian3(r[0] * 1000, r[1] * 1000, r[2] * 1000);  // becomes .x, .y, .z
            positions.push(position);
            rs.push(r);
        }
        orbitTraces.removeAll();

        var traceMaterial = new Cesium.Material({
            fabric : {
                type : 'Color',
                uniforms : {
                    color : {
                        red : 1.0,
                        green : 0.0,
                        blue : 0.8,
                        alpha : 0.7
                    }
                }
            }
        });
        var trace = orbitTraces.add();
        trace.setPositions(positions);
        trace.setMaterial(traceMaterial);
        trace.setWidth(2.0);
    }

    // Switch which satellites are displayed.
    document.getElementById('select_satellite_group').onchange = function () {
        orbitTraces.removeAll();
        getSatrecsFromTLEFile('media/sot/tle/' + this.value + '.txt'); // TODO: security risk?
        ORIGINAL_GROUP = this.value;
        ORIGINAL_SATELLITE = 'null';
        selectedSatelliteIdx = null;
        document.getElementById('satellite_display').setAttribute("style", "display:none");
        window.history.replaceState(null, null, "?group="+ORIGINAL_GROUP);
        getSatrecsFromTLEFile(this.value); // TODO: security risk?
        populateSatelliteSelector();
        populateSatelliteBillboard();
        showGeolocation(scene);
    };

    if(ORIGINAL_SATELLITE !== 'null'){
        for(var i = 0; i < satrecs.length; i++){
            if(satrecs[i]['satnum'] == ORIGINAL_SATELLITE){
                selectedSatelliteIdx = i;
                var now = new Cesium.JulianDate();
                var sats = updateSatrecsPosVel(satrecs, now); // TODO: sgp4 needs minutesSinceEpoch from timeclock
                updateSatelliteBillboards(sats.positions);
                moveCamera();
                showOrbit();
            }
        }
        document.getElementById('select_satellite').value = selectedSatelliteIdx;
    }

    if(ORIGINAL_SATELLITE == 'null') {
        window.history.replaceState(null, null, "?group="+ORIGINAL_GROUP);
    };


    //////////////////////////////////////////
    // UI Button actions

    // Toggle Satellite
    document.getElementById('satellite_button').onclick = function () {
        if (document.getElementById('satellite_form').style.display === 'none' ||  !document.getElementById('satellite_form').style.display) {
            // document.getElementById('satellite_form').style.display = 'block';
            document.getElementById('satellite_form').setAttribute("style", "display:block");
            // document.getElementById('map_display').style.display = 'none';
            document.getElementById('map_display').setAttribute("style", "display:none");
            // document.getElementById('instructions').style.display = 'none';
            document.getElementById('instructions').setAttribute("style", "display:none");
        }
        else {
            // document.getElementById('satellite_form').style.display = 'none';
            document.getElementById('satellite_form').setAttribute("style", "display:none");
        }
    };

    // close Satellite Modal
    document.getElementById('satellite_form_close').onclick = function () {
        document.getElementById('satellite_form').setAttribute("style", "display:none");
        // document.getElementById('satellite_form').style.display = 'none';
    };

    // Close Satellite Information Modal
    document.getElementById('satellite_display_close').onclick = function () {
        document.getElementById('satellite_display').setAttribute("style", "display:none");
        // document.getElementById('satellite_display').style.display = 'none';
        selectedSatelliteIdx = null;
        PLAY = true;
    };

    /////////////////////////////////////////////////////////////////////////////
    // Run the timeclock, drive the animations

    // TOGGLE Play
    document.getElementById('play_button').onclick = function () {
        PLAY = true;
    };
    document.getElementById('pause_button').onclick = function () {
        PLAY = false;
    };

    setInterval(function () {
        var now = new Cesium.JulianDate(); // TODO> we'll want to base on tick and time-speedup

        if (satrecs.length > 0 && PLAY) {
            var sats = updateSatrecsPosVel(satrecs, now); // TODO: sgp4 needs minutesSinceEpoch from timeclock
            satrecs = sats.satrecs;                       // propagate [GLOBAL]
            updateSatelliteBillboards(sats.positions);
        }

        if (selectedSatelliteIdx !== null && PLAY) {
            showOrbit();
            displayStats();
        }

    }, CALC_INTERVAL_MS);

    // Loop the clock

    (function tick() {
        scene.initializeFrame(); // takes optional 'time' argument
        scene.render();
        Cesium.requestAnimationFrame(tick);
    }());

}());
