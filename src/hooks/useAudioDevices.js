import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AudioEngineService } from '../services/AudioEngineService';

const fallbackInput = { id: '', label: 'No microphone detected', source: 'none' };
const fallbackOutput = { id: '', label: 'System default output', source: 'browser' };
const STREAM_ROUTE_STORAGE_KEY = 'morphly.streamRoute.v1';

const wait = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));

function normalizeEngineDevice(device, kind) {
  const id = String(device.index ?? device.id ?? '');
  const hostAPI = device.hostAPI || device.hostAPIName || device.host_api || '';
  const host = hostAPI ? ` - ${hostAPI}` : '';
  const channels =
    kind === 'input'
      ? device.maxInputChannels ?? device.max_input_channels
      : device.maxOutputChannels ?? device.max_output_channels;
  const channelText = channels ? ` - ${channels}ch` : '';

  return {
    id,
    label: `${device.name || `${kind} device ${id}`}${host}${channelText}`,
    source: 'engine',
    raw: device,
  };
}

function engineDeviceRank(device, kind) {
  const name = `${device.name || ''}`.toLowerCase();
  const host = `${device.hostAPI || device.hostAPIName || device.host_api || ''}`.toLowerCase();
  let score = Number(device.index ?? 999);

  if (host.includes('wasapi')) score -= 320;
  if (host.includes('directsound')) score -= 100;
  if (host.includes('mme')) score -= 20;
  if (host.includes('wdm')) score += 30;
  if (name.includes('sound mapper') || name.includes('primary sound')) score += 160;
  if (kind === 'input' && name.includes('internal microphone') && host.includes('wasapi')) score -= 200;
  if (kind === 'input' && name.includes('internal microphone') && host.includes('directsound')) score -= 120;
  if (kind === 'input' && name.includes('headset') && host.includes('directsound')) score -= 160;
  if (kind === 'input' && name.includes('microphone') && host.includes('directsound')) score -= 90;
  if (kind === 'input' && name.includes('microphone') && host.includes('wdm')) score -= 65;
  if (kind === 'input' && name.includes('headset') && host.includes('wasapi')) score -= 220;
  if (kind === 'input' && name.includes('headset') && host.includes('mme')) score += 25;
  if (kind === 'input' && (name.includes('splitcam') || name.includes('audio mixer'))) score += 30;
  if (kind === 'input' && name.includes('internal microphone') && host.includes('mme')) score += 80;
  if (kind === 'output' && (name.includes('speakers') || name.includes('headphones'))) score -= 45;

  return score;
}

function deviceText(device) {
  return `${device?.label || device?.raw?.name || device?.name || ''}`.toLowerCase();
}

function hasAnyDeviceMarker(device, markers) {
  const text = deviceText(device);
  return markers.some((marker) => text.includes(marker));
}

function isVirtualOutputDevice(device) {
  return hasAnyDeviceMarker(device, ['virtual', 'cable', 'vb-audio', 'voicemeeter', 'blackhole', 'soundflower', 'splitcam', 'obs', 'ndi']);
}

function isHeadphoneOutputDevice(device) {
  return hasAnyDeviceMarker(device, ['headphone', 'headphones', 'headset', 'earbuds', 'earphones']);
}

function isLaptopSpeakerOutputDevice(device) {
  return hasAnyDeviceMarker(device, ['speaker', 'speakers', 'realtek', 'internal']);
}

function isRealInputDevice(device) {
  return Boolean(device?.id) && !isLoopbackInputName(deviceText(device));
}

function readStoredStreamRoute() {
  try {
    const raw = window.localStorage?.getItem(STREAM_ROUTE_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function writeStoredStreamRoute(route) {
  try {
    window.localStorage?.setItem(STREAM_ROUTE_STORAGE_KEY, JSON.stringify(route));
  } catch {
    // Local storage may be unavailable in hardened browser contexts.
  }
}

function isUsableEngineDevice(device, kind) {
  const index = Number(device.index ?? device.id);
  const name = `${device.name || ''}`.toLowerCase();
  const channelCount =
    kind === 'input'
      ? Number(device.maxInputChannels ?? device.max_input_channels ?? 0)
      : Number(device.maxOutputChannels ?? device.max_output_channels ?? 0);

  return (
    Number.isFinite(index) &&
    index >= 0 &&
    channelCount > 0 &&
    !name.includes('sound mapper') &&
    !name.includes('primary sound') &&
    (kind !== 'input' || !isLoopbackInputName(name))
  );
}

function isLoopbackInputName(name) {
  return [
    'stereo mix',
    'what u hear',
    'what you hear',
    'wave out',
    'loopback',
    'monitor',
    'speaker output',
    'speakers output',
    'cable output',
    'voicemeeter output',
    'vb-audio output',
  ].some((marker) => name.includes(marker));
}

function stableEngineDevices(devices, kind) {
  const usable = devices.filter((device) => isUsableEngineDevice(device, kind));

  if (kind !== 'output') {
    return usable;
  }

  const nonDirectSoundOutputs = usable.filter((device) => {
    const host = `${device.hostAPI || device.hostAPIName || device.host_api || ''}`.toLowerCase();
    return !host.includes('directsound');
  });

  return nonDirectSoundOutputs.length ? nonDirectSoundOutputs : usable;
}

function sortEngineDevices(devices, kind) {
  return [...devices].sort((left, right) => engineDeviceRank(left.raw || left, kind) - engineDeviceRank(right.raw || right, kind));
}

function findDeviceById(devices, id, predicate = () => true) {
  if (!id) {
    return null;
  }

  return devices.find((device) => device.id === id && predicate(device)) || null;
}

function pickAutomaticInput(inputs, storedRoute) {
  return findDeviceById(inputs, storedRoute.lastInputDeviceId, isRealInputDevice) || inputs.find(isRealInputDevice) || null;
}

function pickVirtualOutput(outputs, storedRoute) {
  return findDeviceById(outputs, storedRoute.lastVirtualOutputDeviceId, isVirtualOutputDevice) || outputs.find(isVirtualOutputDevice) || null;
}

function pickMonitorOutput(outputs, storedRoute, virtualOutput) {
  const validMonitor = (device) => Boolean(device?.id) && device.id !== virtualOutput?.id && !isVirtualOutputDevice(device);

  return (
    findDeviceById(outputs, storedRoute.lastMonitorOutputDeviceId, validMonitor) ||
    outputs.find((device) => validMonitor(device) && isLaptopSpeakerOutputDevice(device)) ||
    outputs.find((device) => validMonitor(device) && isHeadphoneOutputDevice(device)) ||
    outputs.find(validMonitor) ||
    null
  );
}

function normalizeBrowserDevice(device, index, kind) {
  return {
    id: device.deviceId,
    label: device.label || `${kind === 'input' ? 'Microphone' : 'Speaker'} ${index + 1}`,
    source: 'browser',
    raw: device,
  };
}

async function getBrowserDevices() {
  if (!navigator.mediaDevices?.enumerateDevices) {
    return { inputs: [], outputs: [] };
  }

  const devices = await navigator.mediaDevices.enumerateDevices();

  return {
    inputs: devices
      .filter((device) => device.kind === 'audioinput' && !isLoopbackInputName(`${device.label || ''}`.toLowerCase()))
      .map((device, index) => normalizeBrowserDevice(device, index, 'input')),
    outputs: devices.filter((device) => device.kind === 'audiooutput').map((device, index) => normalizeBrowserDevice(device, index, 'output')),
  };
}

export function useAudioDevices() {
  const [inputs, setInputs] = useState([fallbackInput]);
  const [outputs, setOutputs] = useState([fallbackOutput]);
  const [storedStreamRoute, setStoredStreamRoute] = useState(readStoredStreamRoute);
  const [source, setSource] = useState('none');
  const [engineOnline, setEngineOnline] = useState(false);
  const [engineActive, setEngineActive] = useState(false);
  const [engineConfiguration, setEngineConfiguration] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const engineWasReadyRef = useRef(false);
  const engineActiveRef = useRef(false);

  const syncEngineState = useCallback((info) => {
    const active = Boolean(info?.localInterface?.local_voice_changer_interface_active || Number(info?.serverAudioStated) === 1);

    setEngineConfiguration(info?.configuration || null);
    setEngineActive(active);
    engineActiveRef.current = active;
  }, []);

  const refreshDevices = useCallback(async () => {
    setLoading(true);
    setError('');

    try {
      const info = await AudioEngineService.getInfo();
      const engineInputs = sortEngineDevices(
        stableEngineDevices(info.serverAudioInputDevices || [], 'input').map((device) => normalizeEngineDevice(device, 'input')),
        'input'
      );
      const engineOutputs = sortEngineDevices(
        stableEngineDevices(info.serverAudioOutputDevices || [], 'output').map((device) => normalizeEngineDevice(device, 'output')),
        'output'
      );

      setInputs(engineInputs.length ? engineInputs : [fallbackInput]);
      setOutputs(engineOutputs.length ? engineOutputs : [fallbackOutput]);
      setSource('engine');
      setEngineOnline(true);
      syncEngineState(info);
      return { source: 'engine', info };
    } catch (engineError) {
      const electronStatus = await window.electronAPI?.getEngineStatus?.();

      if (!electronStatus?.ready && window.electronAPI?.ensureEngineRunning) {
        try {
          await window.electronAPI.ensureEngineRunning();
          await wait(1200);

          const retryInfo = await AudioEngineService.getInfo();
          const retryInputs = sortEngineDevices(
            stableEngineDevices(retryInfo.serverAudioInputDevices || [], 'input').map((device) => normalizeEngineDevice(device, 'input')),
            'input'
          );
          const retryOutputs = sortEngineDevices(
            stableEngineDevices(retryInfo.serverAudioOutputDevices || [], 'output').map((device) => normalizeEngineDevice(device, 'output')),
            'output'
          );

          setInputs(retryInputs.length ? retryInputs : [fallbackInput]);
          setOutputs(retryOutputs.length ? retryOutputs : [fallbackOutput]);
          setSource('engine');
          setEngineOnline(true);
          syncEngineState(retryInfo);
          return { source: 'engine', info: retryInfo };
        } catch {
          // Fall through to browser devices while Electron continues recovering the engine.
        }
      }

      const browserDevices = await getBrowserDevices();
      setInputs(browserDevices.inputs.length ? browserDevices.inputs : [fallbackInput]);
      setOutputs(browserDevices.outputs.length ? browserDevices.outputs : [fallbackOutput]);
      setSource(browserDevices.inputs.length || browserDevices.outputs.length ? 'browser' : 'none');
      setEngineOnline(false);
      setEngineActive(false);
      engineActiveRef.current = false;
      setEngineConfiguration(null);
      setError(
        electronStatus?.crashed
          ? `Local voice engine crashed. ${electronStatus.error || 'Check the backend bundle.'}`
          : electronStatus?.error || 'Local voice engine is offline. Browser devices are shown as a fallback.'
      );
      return { source: 'browser', error: engineError };
    } finally {
      setLoading(false);
    }
  }, []);

  const streamRoute = useMemo(() => {
    const inputDevice = pickAutomaticInput(inputs, storedStreamRoute);
    const streamOutputDevice = pickVirtualOutput(outputs, storedStreamRoute);
    const monitorOutputDevice = pickMonitorOutput(outputs, storedStreamRoute, streamOutputDevice);
    const virtualCableReady = Boolean(streamOutputDevice);
    const needsVirtualCableInstall = engineOnline && !virtualCableReady;
    const routeHealth = !engineOnline
      ? { status: 'engine-offline', message: 'Voice engine is offline.' }
      : !inputDevice
        ? { status: 'needs-microphone', message: 'No usable real microphone was found.' }
        : !virtualCableReady
          ? { status: 'needs-virtual-cable', message: 'Install or repair VB-CABLE from Morphly setup so other apps can hear Morphly.' }
          : monitorOutputDevice
            ? { status: 'ready', message: 'Ready for streaming with speaker monitoring.' }
            : { status: 'ready-no-monitor', message: 'Ready for streaming without local monitoring.' };

    return {
      mode: 'stream',
      inputDeviceId: inputDevice?.id || '',
      streamOutputDeviceId: streamOutputDevice?.id || '',
      monitorOutputDeviceId: monitorOutputDevice?.id || '',
      inputDevice,
      streamOutputDevice,
      monitorOutputDevice,
      virtualCableReady,
      needsVirtualCableInstall,
      routeHealth,
    };
  }, [engineOnline, inputs, outputs, storedStreamRoute]);

  const rememberStreamRoute = useCallback(
    ({ inputDeviceId, streamOutputDeviceId, monitorOutputDeviceId }) => {
      const current = readStoredStreamRoute();
      const next = { ...current };
      const inputDevice = findDeviceById(inputs, inputDeviceId, isRealInputDevice);
      const streamOutputDevice = findDeviceById(outputs, streamOutputDeviceId, isVirtualOutputDevice);
      const monitorOutputDevice = findDeviceById(
        outputs,
        monitorOutputDeviceId,
        (device) => Boolean(device?.id) && device.id !== streamOutputDeviceId && !isVirtualOutputDevice(device)
      );

      if (inputDevice) {
        next.lastInputDeviceId = inputDevice.id;
      }

      if (streamOutputDevice) {
        next.lastVirtualOutputDeviceId = streamOutputDevice.id;
      }

      if (monitorOutputDevice) {
        next.lastMonitorOutputDeviceId = monitorOutputDevice.id;
      }

      writeStoredStreamRoute(next);
      setStoredStreamRoute(next);
    },
    [inputs, outputs]
  );

  useEffect(() => {
    refreshDevices();

    const removeEngineStatusListener = window.electronAPI?.onEngineStatus?.((status) => {
      const isReady = Boolean(status && typeof status === 'object' && 'ready' in status && status.ready);

      if (isReady && !engineWasReadyRef.current) {
        refreshDevices();
      }

      engineWasReadyRef.current = isReady;
    });

    if (!navigator.mediaDevices?.addEventListener) {
      return removeEngineStatusListener;
    }

    const handleDeviceChange = () => {
      if (!engineActiveRef.current) {
        refreshDevices();
      }
    };

    navigator.mediaDevices.addEventListener('devicechange', handleDeviceChange);

    return () => {
      removeEngineStatusListener?.();
      navigator.mediaDevices.removeEventListener('devicechange', handleDeviceChange);
    };
  }, [refreshDevices]);

  return useMemo(
    () => ({
      inputs,
      outputs,
      streamRoute,
      rememberStreamRoute,
      source,
      engineOnline,
      engineActive,
      engineConfiguration,
      loading,
      error,
      refreshDevices,
    }),
    [engineActive, engineConfiguration, engineOnline, error, inputs, loading, outputs, refreshDevices, rememberStreamRoute, source, streamRoute]
  );
}
