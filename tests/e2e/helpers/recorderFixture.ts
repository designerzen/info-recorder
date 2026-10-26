import type { Page } from "@playwright/test";

/** Deterministic recorder states without permissions, model downloads, or audio. */
export async function mockRecorder(page: Page, options: { text?: string; located?: boolean; recording?: boolean } = {}) {
  await page.route("**/src/recorder/createTranscriber.ts*", (route) => route.fulfill({
    contentType: "application/javascript",
    body: `
      const noop = () => {};
      const listeners = new Set();
      const notify = () => { for (const listener of listeners) listener(); };
      const fixture = {
        paragraphs:[], transcriptParagraphs:[], partialText:'', audioParts:[],
        sourceMedia:null,opfsChunkCount:0,recordingStartedAt:null,
        isTranscriptionSupported:true,isOpfsRecordingAvailable:true,runtimeSupport:{},
        isRecording:${Boolean(options.recording)},isPaused:false,isChangingCapture:false,isPreparing:false,isModelLoading:false,isTranscribingMedia:false,
        sourceActivityRms:0.01,modelInventory:[],error:'',progress:'',
        modelLoadMessage:'',modelLoadProgress:0,modelLoadTotalBytes:0,modelDownloadSpeedBps:0,
        update:noop,dispose:noop,subscribe:listener => { listeners.add(listener); return () => listeners.delete(listener); },
        start:() => { fixture.isRecording=true; fixture.recordingStartedAt=Date.now(); notify(); },
        stop:() => { fixture.isRecording=false; notify(); },
        pause:() => { fixture.isPaused=true; notify(); },
        resume:() => { fixture.isPaused=false; notify(); },
        transcribeMediaFile:async () => { fill('Imported audio.'); notify(); },
        getRecordingSourceMedia:async () => null
      };
      function fill(text) {
        const start = Date.parse('2026-10-22T12:00:00Z');
        fixture.recordingStartedAt=start;
        fixture.paragraphs=[text];
        fixture.transcriptParagraphs=[{id:'p1',text,words:[{text,startMs:1000,endMs:2000}]}];
        fixture.audioParts=${options.located ? "[{name:'p0',sequence:0,startIso:'2026-10-22T12:00:00Z',endIso:'2026-10-22T12:00:08Z',LAT:51.5,LONG:-0.12}]" : "[]"};
      }
      ${options.text ? `fill(${JSON.stringify(options.text)});` : ""}
      window.addEventListener('fixture:transcript', () => { fill('A thought worth keeping.'); notify(); });
      export const createTranscriber = () => fixture;
    `
  }));
}
