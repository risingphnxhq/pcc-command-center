import test from "node:test";
import assert from "node:assert/strict";
import {validateProductionBreakdown} from "./animation-production-breakdown-v1.mjs";

const segment = {index:1,script:"The phoenix enters. The child smiles.",estimated_duration_seconds:8};
const scene = {segment_index:1,scene_number:1,heading:"EXT. GARDEN - DAY",duration_seconds:8,
 scene_script:segment.script,visual_action:"The phoenix lands beside the child.",camera:"Wide shot, then gentle push-in.",
 dialogue:[{speaker:"Phoenix",text:"We can do this together.",delivery:"warm"}],
 sound_cues:[{cue:"soft wing flutter",start_seconds:2}],
 keyframes:[{description:"The child waits in the garden.",frame_fraction:0},{description:"The phoenix lands beside the child.",frame_fraction:1}]};
const input = {channel_policy:{output_spec:{max_total_duration_seconds:60}}};

test("validates a complete scene plan mapped to the reviewed segment",()=>{
 const result=validateProductionBreakdown("EPISODE",{channel_segments:[segment],production_breakdown:[scene]},input);
 assert.equal(result.ok,true);
 assert.equal(result.scene_count,1);
 assert.equal(result.total_duration_seconds,8);
});

test("fails if any scene script omits or changes approved segment text",()=>{
 const result=validateProductionBreakdown("REEL",{channel_segments:[segment],production_breakdown:[{...scene,scene_script:"The phoenix enters."}]},input);
 assert.equal(result.ok,false);
 assert.ok(result.failures.some(g=>g.id==="PRODUCTION_SCRIPT_COVERAGE"));
});

test("fails a scene missing start/end keyframes",()=>{
 const result=validateProductionBreakdown("TV_SPOT",{channel_segments:[segment],production_breakdown:[{...scene,keyframes:[scene.keyframes[0]]}]},input);
 assert.equal(result.ok,false);
 assert.ok(result.failures.some(g=>g.id==="PRODUCTION_SCENE_FIELDS"));
});

test("does not require a video scene plan for a novel manuscript",()=>{
 const result=validateProductionBreakdown("NOVEL",{channel_segments:[segment]},input);
 assert.deepEqual(result,{required:false,ok:true,gates:[],failures:[]});
});

test("fails output that exceeds the registered total duration",()=>{
 const result=validateProductionBreakdown("EPISODE",{channel_segments:[segment],production_breakdown:[scene]},{
  channel_policy:{output_spec:{max_total_duration_seconds:5}}});
 assert.equal(result.ok,false);
 assert.ok(result.failures.some(g=>g.id==="PRODUCTION_DURATION_LIMIT"));
});

test("enforces channel-approved minimum and target runtimes across engine outputs",()=>{
 const profiles=[
  {name:"Angie's World episode",output:"EPISODE",runtime:240,spec:{min_total_duration_seconds:180,max_total_duration_seconds:300}},
  {name:"Phoenix Kids episode",output:"EPISODE",runtime:300,spec:{min_total_duration_seconds:180,max_total_duration_seconds:300}},
  {name:"90-second promo",output:"AD",runtime:90,spec:{target_runtime_seconds:90}},
  {name:"180-second trailer",output:"TV_COMMERCIAL",runtime:180,spec:{target_runtime_seconds:180}},
  {name:"Phoenix Phanimation episode",output:"SERIES_EPISODE",runtime:1500,spec:{target_runtime_seconds:1500}},
 ];
 for(const profile of profiles){
  const sceneCount=Math.ceil(profile.runtime/500);
  const durations=Array.from({length:sceneCount},(_,i)=>i===sceneCount-1
    ? profile.runtime-500*(sceneCount-1):500);
  const segments=durations.map((_,i)=>({index:i+1,script:`Beat ${i+1}.`}));
  const scenes=durations.map((duration,i)=>({
   segment_index:i+1,scene_number:i+1,heading:`INT. TEST ${i+1} - DAY`,duration_seconds:duration,
   scene_script:segments[i].script,visual_action:`Illustrate ${profile.name} beat ${i+1}.`,camera:"Stable readable coverage.",
   dialogue:[],sound_cues:[],keyframes:[{description:"Start.",frame_fraction:0},{description:"End.",frame_fraction:1}],
  }));
  const result=validateProductionBreakdown(profile.output,{channel_segments:segments,production_breakdown:scenes},{channel_policy:{output_spec:profile.spec}});
  assert.equal(result.ok,true,profile.name);
  assert.equal(result.total_duration_seconds,profile.runtime,profile.name);
 }
});

test("rejects a scene plan below the channel's minimum runtime",()=>{
 const result=validateProductionBreakdown("EPISODE",{channel_segments:[segment],production_breakdown:[scene]},
  {channel_policy:{output_spec:{min_total_duration_seconds:180,max_total_duration_seconds:300}}});
 assert.equal(result.ok,false);
 assert.ok(result.failures.some(g=>g.id==="PRODUCTION_DURATION_MINIMUM"));
});

test("uses an exact registered target runtime as both minimum and maximum",()=>{
 const policy={channel_policy:{output_spec:{target_runtime_seconds:90}}};
 const short=validateProductionBreakdown("REEL",{channel_segments:[segment],production_breakdown:[scene]},policy);
 assert.ok(short.failures.some(g=>g.id==="PRODUCTION_DURATION_MINIMUM"));
 const long=validateProductionBreakdown("REEL",{channel_segments:[segment],production_breakdown:[{...scene,duration_seconds:100}]},policy);
 assert.ok(long.failures.some(g=>g.id==="PRODUCTION_DURATION_LIMIT"));
});

test("maps script coverage across whitespace-normalized line breaks",()=>{
 const spacedSegment={...segment,script:"The phoenix enters. The child smiles."};
 const spacedScene={...scene,scene_script:"The phoenix enters.\n\nThe child smiles."};
 const result=validateProductionBreakdown("EPISODE",{channel_segments:[spacedSegment],production_breakdown:[spacedScene]},input);
 assert.equal(result.gates.find(g=>g.id==="PRODUCTION_SCRIPT_COVERAGE").result,"PASS");
});
