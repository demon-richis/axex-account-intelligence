require('dotenv').config();
const express=require('express'); const cors=require('cors'); const {initDB,cleanupExpiredData}=require('./src/db/client'); const {isEmpty,refreshBlocklists}=require('./src/analyzers/blocklistManager'); const auth=require('./src/middleware/auth'); const rateLimit=require('./src/middleware/rateLimit');
const app=express(); app.disable('x-powered-by');
if (/^\d+$/.test(process.env.TRUST_PROXY || '') && Number(process.env.TRUST_PROXY)>0) app.set('trust proxy',Number(process.env.TRUST_PROXY));
else if (process.env.TRUST_PROXY === '1') app.set('trust proxy',1);
const allowedOrigins=(process.env.CORS_ORIGINS||'').split(',').map(origin=>origin.trim()).filter(Boolean); if(allowedOrigins.length) app.use(cors({origin:allowedOrigins}));
app.use(express.json({limit:'100kb'})); app.get('/health',rateLimit.publicLimiter,(req,res)=>res.json({status:'ok',service:'axex-intelligence',analyzedAt:new Date().toISOString()}));
const verifyLink=require('./src/routes/verifyLink'); app.use('/v',verifyLink.publicRouter); app.use(auth); app.use(rateLimit.authLimiter); app.use('/verify-link',verifyLink.protectedRouter);
app.use('/analyze',require('./src/routes/analyze')); app.use('/score',require('./src/routes/score')); app.use('/record',require('./src/routes/record')); app.use('/outcome',require('./src/routes/outcome')); app.use('/alts',require('./src/routes/alts')); app.use('/flag',require('./src/routes/flag')); app.use('/ip',require('./src/routes/ip')); app.use('/stats',require('./src/routes/stats')); app.use('/admin',require('./src/routes/admin'));
app.use((err,req,res,next)=>{console.error('Unhandled request error:',err.message);res.status(500).json({error:'Internal server error'});});
const PORT=Number(process.env.PORT)||3000;
if(require.main===module){
  initDB().then(async()=>{
    if(!process.env.API_KEY) console.warn('[Intelligence] API_KEY is not configured; protected routes will reject requests');
    try { await cleanupExpiredData(); } catch(error) { console.warn('[Intelligence] Retention cleanup failed:', error.message); }
    return app.listen(PORT,'0.0.0.0',()=>{
      console.log(`Axex Intelligence running on port ${PORT}`);
      console.log(`[Intelligence] Database: ${process.env.DATABASE_URL ? 'Neon configured' : 'in-memory development store'}`);
      console.log(`[Intelligence] API authentication: ${process.env.API_KEY ? 'enabled' : 'not configured'}`);
      setInterval(()=>cleanupExpiredData().catch(error=>console.warn('[Intelligence] Retention cleanup failed:',error.message)),24*60*60*1000).unref();
      setTimeout(()=>isEmpty().then(empty=>empty&&refreshBlocklists().catch(error=>console.warn('Initial blocklist refresh failed:',error.message))).catch(error=>console.warn('Blocklist status failed:',error.message)),0);
    });
  }).catch(err=>{console.error('DB init failed:',err);process.exit(1);});
}
module.exports={app};
