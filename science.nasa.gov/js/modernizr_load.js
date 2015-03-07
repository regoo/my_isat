function testWebGL() {
  try {
    return !!window.WebGLRenderingContext && !!document.createElement('canvas').getContext('experimental-webgl');
  } catch(e) {
    return false;
  }
}

Modernizr.load([{
    test : testWebGL(),
    yep: ['js/index.js?v=08261013095020'],
    nope : 'js/redirects/no_webgl.js?v=08261013095020'
  }]);
