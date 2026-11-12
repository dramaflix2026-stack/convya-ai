'use strict';
module.exports = function(req,res){res.setHeader('Cache-Control','no-store');return res.status(200).json({ok:true,module:'prospeccao-v16',searchConfigured:!!(process.env.GOOGLE_MAPS_API_KEY&&process.env.CONVYA_SEARCH_ACCESS_TOKEN),mode:'Google Places New',store:'localStorage',whatsapp:'not-connected'})};
