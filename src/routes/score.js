const router=require('express').Router();
const {getSql,getMemory}=require('../db/client');
const cache=require('../cache/scoreCache');
const { riskLevel, recommendation } = require('../analyzers/thresholds');
router.get('/:userId',async(req,res)=>{const id=String(req.params.userId).trim(); if(!id||id.length>64)return res.status(400).json({error:'userId must be 1-64 characters'}); const hit=cache.get(id); if(hit)return res.json({userId:id,...hit,scoreVersion:'2.0',cached:true,analyzedAt:new Date().toISOString()}); try{const sql=getSql(); const rows=sql?await sql('SELECT risk_score,risk_level,confidence FROM user_intelligence WHERE user_id=$1',[id]):[]; const u=rows[0]||getMemory().users.get(id); if(!u)return res.status(404).json({error:'User not found'}); const riskScore=Number(u.risk_score??u.riskScore??0); const data={riskScore,riskLevel:u.risk_level??u.riskLevel??riskLevel(riskScore),recommendation:recommendation(riskScore),confidence:u.confidence||'low'}; cache.set(id,data); res.json({userId:id,...data,scoreVersion:'2.0',cached:false,analyzedAt:new Date().toISOString()});}catch(e){res.status(503).json({error:'Score lookup unavailable'});}});
module.exports=router;
