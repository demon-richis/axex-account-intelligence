const router=require('express').Router();
const {getSql,getMemory}=require('../db/client');
const cache=require('../cache/scoreCache');
function recommendation(score){return score>=91?'block':score>=76?'queue':score>=51?'challenge':score>=26?'monitor':'allow';}
router.get('/:userId',async(req,res)=>{const id=String(req.params.userId); const hit=cache.get(id); if(hit)return res.json({userId:id,...hit,cached:true,analyzedAt:new Date().toISOString()}); try{const sql=getSql(); const rows=sql?await sql('SELECT risk_score,risk_level FROM user_intelligence WHERE user_id=$1',[id]):[]; const u=rows[0]||getMemory().users.get(id); if(!u)return res.status(404).json({error:'User not found'}); const riskScore=u.risk_score??u.riskScore??0; const data={riskScore,riskLevel:u.risk_level??u.riskLevel??(riskScore<=25?'clean':riskScore<=50?'low':'critical'),recommendation:recommendation(riskScore)}; cache.set(id,data); res.json({userId:id,...data,cached:false,analyzedAt:new Date().toISOString()});}catch(e){res.status(500).json({error:'Score lookup failed'});}});
module.exports=router;
