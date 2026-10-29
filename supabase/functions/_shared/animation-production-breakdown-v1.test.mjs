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
