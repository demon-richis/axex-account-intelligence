const windows = new Map();
function waveMinimum() {
  const parsed = Number(process.env.JOIN_WAVE_MIN);
  return Number.isFinite(parsed) ? Math.max(2, Math.min(20, Math.round(parsed))) : 3;
}
const sweep = setInterval(() => { const now = Date.now(); for (const [guildId, list] of windows) { if (!list.length || now - list[list.length - 1].timestamp > 30000) windows.delete(guildId); } }, 60000);
if (sweep.unref) sweep.unref();
function evaluate(list) { const minimum=waveMinimum(); const ten=list.filter(x=>Date.now()-x.timestamp<=10000).length; const isRaid=list.length>=10 || ten>=5; const raidType=list.length>=10?'RAID':ten>=5?'MICRO_RAID':null; const fresh=list.length>=minimum && list.every(x=>x.accountAgeDays != null && Number.isFinite(Number(x.accountAgeDays)) && Number(x.accountAgeDays)<7); const bot=list.length>=minimum && list.every(x=>x.avatar == null || x.avatar === false); const reasons=[]; if(raidType) reasons.push(`JOIN_${raidType}`); if(fresh) reasons.push('ACCOUNT_AGE_WAVE'); if(bot) reasons.push('DEFAULT_AVATAR_WAVE'); return {isRaid,raidType,joinCount:list.length,accountWave:fresh,botWave:bot,sequential:false,score:isRaid?20:(fresh?15:(bot?25:0)),reasons}; }
function analyzeJoin(guildId,userId,metadata={}) { const id=String(guildId); const now=Date.now(); const list=(windows.get(id)||[]).filter(x=>now-x.timestamp<=30000); return evaluate([...list,{userId:String(userId),timestamp:now,...metadata}]); }
function recordJoin(guildId,userId,metadata={}) { const id=String(guildId); const now=Date.now(); const list=(windows.get(id)||[]).filter(x=>now-x.timestamp<=30000); list.push({userId:String(userId),timestamp:now,...metadata}); windows.set(id,list); return evaluate(list); }
function getGuildJoinPattern(guildId) { const list=windows.get(String(guildId))||[]; return {guildId:String(guildId),joinCount:list.length,joins:list}; }
function clearIfInactive(guildId) { const id=String(guildId); const list=windows.get(id)||[]; if(!list.length||Date.now()-list[list.length-1].timestamp>30000){windows.delete(id);return true;} return false; }
module.exports={recordJoin,analyzeJoin,getGuildJoinPattern,clearIfInactive};
