jQuery(document).ready(function ($) {
  opsmode = 'i'; /*GLOBAL for intl, 'i'mproved */

  var images = new Array();
  function preload() {
    for (i = 0; i < preload.arguments.length; i++) {
      images[i] = new Image();
      images[i].src = preload.arguments[i];
    }
  }
  preload(
    '/images/Banner.jpg',
    '/images/Title.png',
    '/images/NASA_logo.png',
    '/images/Zoom_out.png',
    '/images/Zoom_in.png',
    '/images/Refresh_1.png',
    '/images/Refresh_2.png',
    '/images/Info_1.png',
    '/images/Info_2.png',
    '/images/Orbit_1.png',
    '/images/Orbit_2.png',
    '/images/Satellite_1.png',
    '/images/Satellite_2.png',
    '/images/Expand_1.png',
    '/images/Expand_2b.png',
    '/images/Pause_1.png',
    '/images/Pause_2.png',
    '/images/Play_1.png',
    '/images/Play_2.png'
  );
});
