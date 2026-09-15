'use client';
import { useEffect, useRef, useState } from 'react';
import { Mic, Square, LoaderCircle } from 'lucide-react';
import { AUDIO_BYTES, RECORDING_SECONDS } from '@/lib/assistant-audio';

export function AssistantVoice({
  workspace,
  view,
  open,
  disabled,
  onText,
  onBusy,
}: {
  workspace: string;
  view: string;
  open: boolean;
  disabled: boolean;
  onText: (text: string) => void;
  onBusy: (busy: boolean) => void;
}) {
  const [phase, setPhase] = useState<
    'idle' | 'permission' | 'recording' | 'transcribing'
  >('idle');
  const [seconds, setSeconds] = useState(0),
    [error, setError] = useState('');
  const [review, setReview] = useState(false);
  const session = useRef(0),
    stream = useRef<MediaStream | null>(null);
  const recorder = useRef<MediaRecorder | null>(null),
    timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const abort = useRef<AbortController | null>(null),
    retry = useRef<File | null>(null);
  const onTextRef = useRef(onText);
  onTextRef.current = onText;
  function stopHardware() {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    if (recorder.current?.state === 'recording') recorder.current.stop();
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
  }
  function dispose() {
    session.current++;
    stopHardware();
    abort.current?.abort();
    retry.current = null;
  }
  function cancel() {
    dispose();
    setPhase('idle');
    setError('');
    setReview(false);
  }
  useEffect(() => {
    cancel();
    return () => {
      dispose();
      onBusy(false);
    };
  }, [workspace, view, open]);
  useEffect(() => {
    onBusy(phase !== 'idle');
  }, [phase, onBusy]);
  // A hidden page must never leave the microphone running.
  useEffect(() => {
    const hide = () => {
      if (document.hidden) cancel();
    };
    document.addEventListener('visibilitychange', hide);
    return () => document.removeEventListener('visibilitychange', hide);
  }, []);
  async function transcribe(file: File, id: number) {
    if (id !== session.current) return;
    retry.current = file;
    setPhase('transcribing');
    setError('');
    const controller = new AbortController();
    abort.current = controller;
    try {
      const body = new FormData();
      body.set('audio', file);
      const res = await fetch(
        '/api/assistant/voice?' + new URLSearchParams({ workspace, view }),
        {
          method: 'POST',
          body,
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(70000),
          ]),
        },
      );
      const result: any = await res.json();
      if (!res.ok)
        throw new Error(
          result.error ||
            'Could not transcribe your recording. Please try again.',
        );
      if (id !== session.current) return;
      onTextRef.current(result.text);
      retry.current = null;
      setReview(true);
    } catch (e) {
      if (id === session.current)
        setError(
          (e as Error).name === 'TimeoutError'
            ? 'Transcription took too long. Retry the recording or type your instruction.'
            : (e as Error).message,
        );
    } finally {
      if (id === session.current) setPhase('idle');
    }
  }
  async function start() {
    if (disabled || phase !== 'idle') return;
    cancel();
    if (
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === 'undefined'
    ) {
      setError(
        'Voice recording is unavailable in this browser. Open the site in Chrome, Edge or Safari, or type your instruction.',
      );
      return;
    }
    const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find(
      (m) => MediaRecorder.isTypeSupported(m),
    );
    if (!mime) {
      setError(
        'This browser cannot record a supported audio format. Please type your instruction.',
      );
      return;
    }
    const id = session.current;
    setPhase('permission');
    try {
      const media = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (id !== session.current) {
        media.getTracks().forEach((t) => t.stop());
        return;
      }
      stream.current = media;
      const rec = new MediaRecorder(media, {
        mimeType: mime,
        audioBitsPerSecond: 64000,
      });
      recorder.current = rec;
      const chunks: Blob[] = [];
      let size = 0;
      rec.ondataavailable = (e) => {
        if (id !== session.current) return;
        size += e.data.size;
        if (size > AUDIO_BYTES) {
          cancel();
          setError(
            'That recording is too large. Please record a shorter instruction.',
          );
          return;
        }
        if (e.data.size) chunks.push(e.data);
      };
      rec.onerror = () => {
        if (id === session.current) {
          cancel();
          setError('Recording was interrupted. Please try again.');
        }
      };
      rec.onstop = () => {
        if (id !== session.current) return;
        stopHardware();
        if (!size) {
          setPhase('idle');
          setError('No audio was recorded. Please try again.');
          return;
        }
        void transcribe(
          new File(
            chunks,
            mime.includes('mp4') ? 'instruction.mp4' : 'instruction.webm',
            { type: mime },
          ),
          id,
        );
      };
      rec.start(1000);
      setSeconds(0);
      setPhase('recording');
      const started = Date.now();
      timer.current = setInterval(() => {
        const elapsed = Math.floor((Date.now() - started) / 1000);
        setSeconds(elapsed);
        if (elapsed >= RECORDING_SECONDS) stopHardware();
      }, 250);
    } catch (e) {
      if (id !== session.current) return;
      stopHardware();
      setPhase('idle');
      setError(
        (e as Error).name === 'NotAllowedError'
          ? 'Microphone access was not allowed. Enable it in your browser’s site settings, or type your instruction.'
          : 'Could not open your microphone. Check it is connected and not in use, or type your instruction.',
      );
    }
  }
  const working = phase !== 'idle';
  return (
    <>
      <button
        type="button"
        className={
          'btn assistant-mic' + (phase === 'recording' ? ' recording' : '')
        }
        disabled={disabled && !working}
        onClick={() =>
          phase === 'recording'
            ? stopHardware()
            : working
              ? cancel()
              : void start()
        }
        aria-label={
          phase === 'recording'
            ? 'Stop recording and transcribe'
            : working
              ? 'Cancel voice instruction'
              : 'Speak your instruction'
        }
      >
        {phase === 'recording' ? (
          <Square size={17} />
        ) : working ? (
          <LoaderCircle size={17} className="assistant-spin" />
        ) : (
          <Mic size={18} />
        )}
        {phase === 'recording' ? 'Stop' : working ? 'Cancel' : 'Speak'}
      </button>
      {(working || error || review) && (
        <div className="assistant-voice-status">
          <p role={error ? 'alert' : 'status'}>
            {error ||
              (phase === 'permission'
                ? 'Allow microphone access to begin.'
                : phase === 'recording'
                  ? `Recording · ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')} / 1:30`
                  : phase === 'transcribing'
                    ? 'Turning your recording into text…'
                    : 'Added to your instruction. Check the wording, then press Send.')}
          </p>
          {phase === 'recording' && (
            <button type="button" className="text-link" onClick={cancel}>
              Cancel recording
            </button>
          )}
          {error && retry.current && (
            <div className="assistant-voice-retry">
              <button
                type="button"
                className="text-link"
                disabled={disabled}
                onClick={() => void transcribe(retry.current!, session.current)}
              >
                Retry transcription
              </button>
              <button type="button" className="text-link" onClick={cancel}>
                Discard recording
              </button>
            </div>
          )}
        </div>
      )}
    </>
  );
}
