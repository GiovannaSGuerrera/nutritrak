// The build compiles the API before Vercel packages this function.
module.exports = require('../apps/api/dist/server.js').requestHandler;
