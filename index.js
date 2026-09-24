require('dotenv').config();
const express=require('express'); const cors=require('cors'); const {initDB}=require('./src/db/client'); const auth=require('./src/middleware/auth'); const rateLimit=require('./src/middleware/rateLimit');
const app=express(); app.disable('x-powered-by'); app.set('trust proxy',process.env.TRUST_PROXY==='true');
const allowedOrigins=(process.env.CORS_ORIGINS||'').split(',').map(origin=>origin.trim()).filter(Boolean); if(allowedOrigins.length) app.use(cors({origin:allowedOrigins}));
app.use(express.json({limit:'100kb'})); app.use(rateLimit); app.get('/health',(req,res)=>res.json({status:'ok',service:'axex-intelligence',analyzedAt:new Date().toISOString()})); app.use(auth);
app.use('/analyze',require('./src/routes/analyze')); app.use('/score',require('./src/routes/score')); app.use('/record',require('./src/routes/record')); app.use('/alts',require('./src/routes/alts')); app.use('/flag',require('./src/routes/flag')); app.use('/ip',require('./src/routes/ip')); app.use('/stats',require('./src/routes/stats'));
app.use((err,req,res,next)=>{console.error('Unhandled request error:',err.message);res.status(500).json({error:'Internal server error'});});
const PORT=Number(process.env.PORT)||3000;
if(require.main===module){initDB().then(()=>app.listen(PORT,'0.0.0.0',()=>console.log(`Axex Intelligence running on port ${PORT}`))).catch(err=>{console.error('DB init failed:',err);process.exit(1);});}
module.exports={app};
