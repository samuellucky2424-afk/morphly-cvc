import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AudioWaveform,
  BadgeCheck,
  Bot,
  Check,
  ChevronRight,
  CircleDollarSign,
  Copy,
  Cpu,
  CreditCard,
  Gauge,
  Headphones,
  Info,
  KeyRound,
  LockKeyhole,
  LogOut,
  Mail,
  Menu,
  Mic2,
  Moon,
  Play,
  Power,
  RefreshCw,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Square,
  User,
  UserPlus,
  Upload,
  Volume2,
  WalletCards,
  Zap,
} from 'lucide-react';
import { useAuth } from './context/AuthContext.jsx';
import { useAudioDevices } from './hooks/useAudioDevices.js';
import { useCreditTopUp } from './hooks/useCreditTopUp.js';
import { CREDITS_PER_STARTED_MINUTE, billVoiceUsage, isMorphlyApiConfigured, startVoiceUsage, stopVoiceUsage } from './lib/morphlyApi.js';
import { AudioEngineError, AudioEngineService } from './services/AudioEngineService';

const navItems = [
  { id: 'studio', label: 'Voice Studio', icon: AudioWaveform },
  { id: 'credits', label: 'Credits', icon: WalletCards },
  { id: 'settings', label: 'Settings', icon: Settings },
];

const voiceModelIcons = [User, BadgeCheck, Sparkles, Bot, AudioWaveform, Cpu];
const voiceModelColors = [
  'from-teal-400 to-emerald-300',
  'from-sky-400 to-teal-300',
  'from-fuchsia-400 to-rose-300',
  'from-amber-300 to-orange-500',
  'from-lime-300 to-teal-400',
  'from-cyan-300 to-violet-400',
];

const emptyVoiceModel = {
  id: '',
  slot: 0,
  speaker: 0,
  name: 'No backend voices',
  accent: 'Waiting for voice engine',
  icon: Bot,
  color: 'from-slate-500 to-slate-400',
  modelName: 'No model',
  voiceFamily: 'other',
  voiceFamilyLabel: 'Other',
  voiceGender: 'unknown',
  voiceGenderLabel: 'Unlabeled',
};

function decorateVoiceModel(model, index) {
  const color =
    model.voiceGender === 'female'
      ? 'from-rose-300 to-fuchsia-400'
      : model.voiceGender === 'male'
        ? 'from-sky-300 to-cyan-400'
        : voiceModelColors[index % voiceModelColors.length];
  const icon = model.voiceFamily === 'beatrice' ? Sparkles : model.voiceGender === 'male' ? User : voiceModelIcons[index % voiceModelIcons.length];

  return {
    ...model,
    icon,
    color,
  };
}

function voiceFamily(model) {
  if (model?.voiceFamily) {
    return model.voiceFamily;
  }

  return model?.voiceChangerType === 'RVC' ? 'rvc' : `${model?.voiceChangerType || ''}`.toLowerCase().includes('beatrice') ? 'beatrice' : 'other';
}

function voiceGender(model) {
  return model?.voiceGender || 'unknown';
}

function voiceGroupMatches(model, section) {
  return voiceFamily(model) === section.family && voiceGender(model) === section.gender;
}

const voiceFilterTabs = [
  { id: 'all', label: 'All' },
  { id: 'female', label: 'Female' },
  { id: 'male', label: 'Male' },
];

const voiceSections = [
  { id: 'rvc-female', title: 'Female RVC Voices', family: 'rvc', gender: 'female' },
  { id: 'beatrice-female', title: 'Beatrice Female Tone', family: 'beatrice', gender: 'female' },
  { id: 'rvc-male', title: 'Male RVC Voices', family: 'rvc', gender: 'male' },
  { id: 'beatrice-male', title: 'Beatrice Male Tone', family: 'beatrice', gender: 'male' },
  { id: 'unlabeled', title: 'Unlabeled Voices', family: 'other', gender: 'unknown' },
];

function requiresOnnxOptimization(model) {
  return model?.voiceChangerType === 'RVC' && !model?.isCpuOptimized;
}

function firstSelectableModelId(models) {
  return models.find((model) => !requiresOnnxOptimization(model))?.id || '';
}

const plans = [
  { id: 'basic', name: 'Basic', amount: 3500, currency: 'NGN', priceDisplay: 'NGN 3,500', credits: 180, accent: 'Starter voice experiments', meter: 32 },
  { id: 'pro', name: 'Pro', amount: 9500, currency: 'NGN', priceDisplay: 'NGN 9,500', credits: 720, accent: 'Streaming and creators', meter: 68, featured: true },
  { id: 'studio', name: 'Studio', amount: 24000, currency: 'NGN', priceDisplay: 'NGN 24,000', credits: 2400, accent: 'Teams and production', meter: 92 },
];

const bars = [42, 72, 36, 88, 54, 66, 94, 48, 78, 58, 84, 44, 68, 96, 52, 74, 40, 62];

const voiceQualityProfiles = {
  conversation: {
    label: 'Clear',
    chunk: 128,
    pitch: 0,
    formant: 0,
    accent: 'Clean voice',
  },
};

function deviceText(device) {
  return `${device?.label || device?.raw?.name || ''}`.toLowerCase();
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

function isLoopbackInputDevice(device) {
  return hasAnyDeviceMarker(device, [
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
  ]);
}

function shouldMuteOutputDevice(device) {
  return Boolean(device && !isVirtualOutputDevice(device) && !isHeadphoneOutputDevice(device));
}

function findFirstOutputDevice(devices, matcher) {
  return devices.find((device) => device.id && matcher(device)) || null;
}

function findFirstInputDevice(devices) {
  return devices.find((device) => device.id && !isLoopbackInputDevice(device)) || null;
}

function App() {
  const {
    user,
    credits,
    displayEmail,
    displayName,
    loading,
    error: authContextError,
    isSupabaseConfigured,
    signIn,
    signUp,
    signInWithGoogle,
    signOut,
    applyProfile,
    saveProfile,
  } = useAuth();

  const [activeView, setActiveView] = useState('studio');
  const [authMode, setAuthMode] = useState('signin');
  const [auth, setAuth] = useState({ email: '', password: '' });
  const [authTouched, setAuthTouched] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState('');
  const [routeMode, setRouteMode] = useState('stream');
  const [selectedInput, setSelectedInput] = useState('');
  const [selectedOutput, setSelectedOutput] = useState('');
  const [monitorOutput, setMonitorOutput] = useState('');
  const [voiceModels, setVoiceModels] = useState([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState('');
  const [selectedModel, setSelectedModel] = useState('');
  const [pitch, setPitch] = useState(0);
  const [formant, setFormant] = useState(0);
  const [chunk, setChunk] = useState(voiceQualityProfiles.conversation.chunk);
  const [qualityMode, setQualityMode] = useState('conversation');
  const [isLive, setIsLive] = useState(false);
  const [usageSessionId, setUsageSessionId] = useState('');
  const [engineBusy, setEngineBusy] = useState(false);
  const [echoGuard, setEchoGuard] = useState(true);
  const [toast, setToast] = useState(null);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [preferences, setPreferences] = useState({
    boot: true,
    lightMode: false,
    telemetry: false,
    defaultModel: '',
  });
  const settingsTouchedRef = useRef(false);
  const usageSessionRef = useRef('');
  const billingInFlightRef = useRef(false);
  const audioDevices = useAudioDevices();

  const emailValid = /^\S+@\S+\.\S+$/.test(auth.email);
  const passwordValid = auth.password.length >= 8;
  const canSubmit = emailValid && passwordValid && !authBusy;
  const currentModel = useMemo(() => voiceModels.find((model) => model.id === selectedModel) || voiceModels[0] || emptyVoiceModel, [selectedModel, voiceModels]);
  const estimatedLatency = useMemo(() => Math.max(1, Math.round((chunk * 128 * 1000) / 48000)), [chunk]);
  const normalizedCredits = Math.max(0, Number(credits) || 0);
  const selectedInputDevice = useMemo(
    () => audioDevices.inputs.find((device) => device.id === selectedInput) || null,
    [audioDevices.inputs, selectedInput]
  );
  const selectedOutputDevice = useMemo(
    () => audioDevices.outputs.find((device) => device.id === selectedOutput) || null,
    [audioDevices.outputs, selectedOutput]
  );
  const monitorOutputDevice = useMemo(
    () => audioDevices.outputs.find((device) => device.id === monitorOutput) || null,
    [audioDevices.outputs, monitorOutput]
  );
  const streamRoute = audioDevices.streamRoute || {
    mode: 'stream',
    inputDeviceId: '',
    streamOutputDeviceId: '',
    monitorOutputDeviceId: '',
    virtualCableReady: false,
    needsVirtualCableInstall: false,
    routeHealth: { status: 'engine-offline', message: 'Voice engine is offline.' },
  };
  const selectedInputIsLoopback = Boolean(selectedInputDevice && isLoopbackInputDevice(selectedInputDevice));
  const selectedOutputNeedsMute = shouldMuteOutputDevice(selectedOutputDevice);
  const selectedOutputEchoProtected = Boolean(echoGuard && selectedOutputNeedsMute);
  const streamRouteActive = routeMode === 'stream';
  const streamRouteBlocked = streamRouteActive && streamRoute.needsVirtualCableInstall;
  const routeReady = Boolean(selectedInput && selectedOutput && !streamRouteBlocked);

  useEffect(() => {
    if (selectedInput && !audioDevices.inputs.some((device) => device.id === selectedInput)) {
      setSelectedInput('');
    }
  }, [audioDevices.inputs, selectedInput]);

  useEffect(() => {
    if (selectedOutput && !audioDevices.outputs.some((device) => device.id === selectedOutput)) {
      setSelectedOutput('');
    }
  }, [audioDevices.outputs, selectedOutput]);

  useEffect(() => {
    if (monitorOutput && !audioDevices.outputs.some((device) => device.id === monitorOutput)) {
      setMonitorOutput('');
    }
  }, [audioDevices.outputs, monitorOutput]);

  useEffect(() => {
    if (!streamRouteActive || isLive) {
      return;
    }

    setSelectedInput(streamRoute.inputDeviceId || '');
    setSelectedOutput(streamRoute.streamOutputDeviceId || '');
    setMonitorOutput(streamRoute.monitorOutputDeviceId || '');
  }, [isLive, streamRoute.inputDeviceId, streamRoute.monitorOutputDeviceId, streamRoute.streamOutputDeviceId, streamRouteActive]);

  useEffect(() => {
    if (!audioDevices.engineOnline) {
      return;
    }

    const configuration = audioDevices.engineConfiguration;

    if (!audioDevices.engineActive || !configuration) {
      return;
    }

    const inputId = String(configuration.audio_input_device_index ?? '');
    const outputId = String(configuration.audio_output_device_index ?? '');
    const monitorId = String(configuration.audio_monitor_device_index ?? '');

    if (inputId && audioDevices.inputs.some((device) => device.id === inputId)) {
      setSelectedInput((current) => current || inputId);
    }

    if (outputId && audioDevices.outputs.some((device) => device.id === outputId)) {
      setSelectedOutput((current) => current || outputId);
    }

    if (monitorId && monitorId !== '-1' && audioDevices.outputs.some((device) => device.id === monitorId)) {
      setMonitorOutput((current) => current || monitorId);
    }

    setIsLive(true);
  }, [audioDevices.engineActive, audioDevices.engineConfiguration, audioDevices.engineOnline, audioDevices.inputs, audioDevices.outputs]);

  const showToast = useCallback((message, tone = 'info') => {
    setToast({ message, tone, id: Date.now() });
  }, []);

  useEffect(() => {
    usageSessionRef.current = usageSessionId;
  }, [usageSessionId]);

  const finishUsageSession = useCallback(async () => {
    const sessionId = usageSessionRef.current;

    if (!sessionId) {
      return null;
    }

    usageSessionRef.current = '';
    setUsageSessionId('');

    try {
      const result = await stopVoiceUsage(sessionId);
      if (result?.profile) {
        applyProfile(result.profile);
      }
      return result;
    } catch (error) {
      return null;
    }
  }, [applyProfile]);

  useEffect(() => {
    if (!isLive || !usageSessionId) {
      return undefined;
    }

    const interval = window.setInterval(async () => {
      if (billingInFlightRef.current) {
        return;
      }

      billingInFlightRef.current = true;
      try {
        const result = await billVoiceUsage(usageSessionId);
        if (result?.profile) {
          applyProfile(result.profile);
        }

        if (!result?.ok) {
          usageSessionRef.current = '';
          setUsageSessionId('');
          await AudioEngineService.stopEngine().catch(() => {});
          setIsLive(false);
          showToast(
            result?.code === 'INSUFFICIENT_CREDITS'
              ? 'Credits finished. Voice conversion stopped.'
              : 'Cloud billing session ended. Voice conversion stopped.',
            'error'
          );
        }
      } catch (error) {
        usageSessionRef.current = '';
        setUsageSessionId('');
        await AudioEngineService.stopEngine().catch(() => {});
        setIsLive(false);
        showToast('Could not confirm credits with Morphly cloud, so conversion stopped.', 'error');
      } finally {
        billingInFlightRef.current = false;
      }
    }, 60_000);

    return () => window.clearInterval(interval);
  }, [applyProfile, isLive, showToast, usageSessionId]);

  useEffect(() => {
    if (!isLive || usageSessionId || engineBusy) {
      return undefined;
    }

    if (!user?.id) {
      AudioEngineService.stopEngine().catch(() => {});
      setIsLive(false);
      showToast('Sign in before starting voice conversion.', 'error');
      return undefined;
    }

    let cancelled = false;

    (async () => {
      try {
        const usageStart = await startVoiceUsage();

        if (cancelled) {
          if (usageStart?.sessionId) {
            await stopVoiceUsage(usageStart.sessionId).catch(() => {});
          }
          return;
        }

        if (!usageStart?.ok) {
          if (usageStart?.profile) {
            applyProfile(usageStart.profile);
          }
          await AudioEngineService.stopEngine().catch(() => {});
          setIsLive(false);
          showToast('Voice conversion stopped because Morphly could not start cloud billing.', 'error');
          return;
        }

        setUsageSessionId(usageStart.sessionId || '');
        usageSessionRef.current = usageStart.sessionId || '';
        if (usageStart.profile) {
          applyProfile(usageStart.profile);
        }
      } catch (error) {
        if (!cancelled) {
          await AudioEngineService.stopEngine().catch(() => {});
          setIsLive(false);
          showToast('Voice conversion stopped because Morphly cloud billing is unavailable.', 'error');
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [applyProfile, engineBusy, isLive, showToast, usageSessionId, user?.id]);

  const refreshModels = useCallback(async () => {
    setModelsLoading(true);
    setModelsError('');

    try {
      const info = await AudioEngineService.getInfo();
      const liveModels = AudioEngineService.getAvailableVoiceModels(info).map(decorateVoiceModel);

      setVoiceModels(liveModels);
      setSelectedModel((current) => {
        if (current && liveModels.some((model) => model.id === current && !requiresOnnxOptimization(model))) {
          return current;
        }

        return firstSelectableModelId(liveModels);
      });
      setPreferences((current) => {
        if (current.defaultModel && liveModels.some((model) => model.id === current.defaultModel && !requiresOnnxOptimization(model))) {
          return current;
        }

        return { ...current, defaultModel: firstSelectableModelId(liveModels) };
      });

      if (!liveModels.length) {
        setModelsError('No loaded backend model slots were reported by the engine.');
      }

      return liveModels;
    } catch (error) {
      setVoiceModels([]);
      setSelectedModel('');
      setModelsError(error?.message || 'Unable to load backend voices.');
      return [];
    } finally {
      setModelsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!toast) {
      return undefined;
    }

    const timeout = window.setTimeout(() => setToast(null), 3600);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  useEffect(() => {
    if (!audioDevices.engineOnline) {
      setVoiceModels([]);
      setSelectedModel('');
      return;
    }

    refreshModels();
  }, [audioDevices.engineOnline, refreshModels]);

  const handleEngineError = useCallback(
    (error) => {
      if (error instanceof AudioEngineError || error?.code === 'ENGINE_OFFLINE') {
        if (error?.code === 'MODEL_NOT_LOADED') {
          showToast('That voice is not loaded yet. Start will load it first.', 'error');
          return;
        }

        if (error?.code === 'MODEL_LOAD_FAILED') {
          showToast('Could not load the selected voice model. Check the backend/model files.', 'error');
          return;
        }

        if (error?.code === 'MODEL_UPLOAD_FAILED' || error?.code === 'MODEL_IMPORT_FAILED') {
          showToast(error.message || 'Could not import and optimize that RVC model.', 'error');
          return;
        }

        if (error?.code === 'ENGINE_START_FAILED') {
          showToast('The engine did not confirm live conversion. No audio was started.', 'error');
          return;
        }

        if (error?.code === 'AUDIO_DEVICE_NOT_FOUND') {
          showToast(error.message || 'No usable audio device is available.', 'error');
          return;
        }

        showToast('Engine Offline. Morphly is restarting the local voice engine.', 'error');
        return;
      }

      showToast(error?.message || 'Voice engine request failed.', 'error');
    },
    [showToast]
  );

  useEffect(() => {
    if (!settingsTouchedRef.current) {
      return undefined;
    }

    const timeout = window.setTimeout(() => {
      AudioEngineService.updateSettings(pitch, chunk, formant, qualityMode, selectedModel).catch(handleEngineError);
    }, 180);

    return () => window.clearTimeout(timeout);
  }, [pitch, formant, chunk, qualityMode, selectedModel, handleEngineError]);

  const submitAuth = useCallback(
    async (event) => {
      event.preventDefault();
      setAuthTouched(true);
      setAuthError('');

      if (!canSubmit) {
        return;
      }

      setAuthBusy(true);
      try {
        if (authMode === 'signin') {
          await signIn(auth.email, auth.password);
          showToast('Signed in successfully.', 'success');
        } else {
          await signUp(auth.email, auth.password);
          showToast('Account created. Check your inbox if confirmation is enabled.', 'success');
        }
      } catch (error) {
        setAuthError(error.message || 'Authentication failed.');
      } finally {
        setAuthBusy(false);
      }
    },
    [auth, authMode, canSubmit, showToast, signIn, signUp]
  );

  const handleGoogleAuth = useCallback(async () => {
    setAuthError('');
    try {
      await signInWithGoogle();
    } catch (error) {
      setAuthError(error.message || 'Google sign-in failed.');
    }
  }, [signInWithGoogle]);

  const handleSignOut = useCallback(async () => {
    try {
      if (isLive) {
        try {
          await AudioEngineService.stopEngine();
        } finally {
          await finishUsageSession();
        }
        setIsLive(false);
      }
      await signOut();
      showToast('Signed out.', 'success');
    } catch (error) {
      showToast(error.message || 'Could not sign out cleanly.', 'error');
    }
  }, [finishUsageSession, isLive, showToast, signOut]);

  const toggleEngine = useCallback(async () => {
    if (!isLive && !isMorphlyApiConfigured) {
      showToast('Morphly cloud API is required before starting paid voice conversion.', 'error');
      return;
    }

    if (!isLive && normalizedCredits < CREDITS_PER_STARTED_MINUTE) {
      showToast(`Add voice credits before starting. Voice conversion costs ${CREDITS_PER_STARTED_MINUTE} credits per started minute.`, 'error');
      return;
    }

    if (!selectedModel) {
      showToast('No backend voice model is loaded yet.', 'error');
      return;
    }

    if (requiresOnnxOptimization(currentModel)) {
      showToast('Model must be optimized to ONNX for CPU execution.', 'error');
      return;
    }

    if (streamRouteBlocked) {
      showToast('Install or repair VB-CABLE from Morphly setup before starting Stream Mode.', 'error');
      return;
    }

    if (!selectedInput || !selectedOutput) {
      showToast(streamRouteActive ? 'Stream Mode needs a microphone and virtual cable output.' : 'Choose a microphone and speaker before starting.', 'error');
      return;
    }

    if (selectedInputIsLoopback) {
      showToast('Choose a real microphone. Loopback or speaker-capture inputs will repeat your converted voice.', 'error');
      return;
    }

    setEngineBusy(true);
    try {
      if (isLive) {
        try {
          await AudioEngineService.stopEngine();
        } finally {
          await finishUsageSession();
        }
        setIsLive(false);
        showToast('Voice conversion stopped.', 'success');
      } else {
        showToast('Loading selected voice and connecting microphone...', 'info');
        await AudioEngineService.startEngine({
          modelId: selectedModel,
          inputDeviceId: selectedInput,
          outputDeviceId: selectedOutput,
          monitorOutputDeviceId: monitorOutput || undefined,
          pitch,
          formant,
          chunkSize: chunk,
          mutePhysicalOutput: echoGuard,
          qualityMode,
        });

        let usageStart;
        try {
          usageStart = await startVoiceUsage();
        } catch (billingError) {
          await AudioEngineService.stopEngine().catch(() => {});
          throw billingError;
        }

        if (!usageStart?.ok) {
          await AudioEngineService.stopEngine().catch(() => {});
          if (usageStart?.profile) {
            applyProfile(usageStart.profile);
          }
          showToast(
            usageStart?.code === 'INSUFFICIENT_CREDITS'
              ? `You need at least ${CREDITS_PER_STARTED_MINUTE} credits to start voice conversion.`
              : 'Could not start Morphly cloud billing for this voice session.',
            'error'
          );
          return;
        }

        setUsageSessionId(usageStart.sessionId || '');
        usageSessionRef.current = usageStart.sessionId || '';
        if (usageStart.profile) {
          applyProfile(usageStart.profile);
        }

        audioDevices.rememberStreamRoute?.({
          inputDeviceId: selectedInput,
          streamOutputDeviceId: selectedOutput,
          monitorOutputDeviceId: monitorOutput,
        });
        setIsLive(true);
        showToast(
          selectedOutputEchoProtected
            ? 'Voice conversion is live. Use headphones if you hear feedback.'
            : 'Voice conversion is live through the local engine.',
          'success'
        );
      }
    } catch (error) {
      handleEngineError(error);
    } finally {
      setEngineBusy(false);
    }
  }, [applyProfile, audioDevices, chunk, currentModel, echoGuard, finishUsageSession, formant, handleEngineError, isLive, monitorOutput, normalizedCredits, pitch, qualityMode, selectedInput, selectedInputIsLoopback, selectedModel, selectedOutput, selectedOutputEchoProtected, selectedOutputNeedsMute, showToast, streamRouteActive, streamRouteBlocked]);

  const handleModelSelect = useCallback(
    async (modelId) => {
      if (!modelId || modelId === selectedModel) {
        return;
      }

      const nextModel = voiceModels.find((model) => model.id === modelId);
      if (requiresOnnxOptimization(nextModel)) {
        showToast('Model must be optimized to ONNX for CPU execution.', 'error');
        return;
      }

      setSelectedModel(modelId);
      setEngineBusy(true);
      try {
        if (isLive && selectedInput && selectedOutput) {
          await AudioEngineService.stopEngine();
          await AudioEngineService.startEngine({
            modelId,
            inputDeviceId: selectedInput,
            outputDeviceId: selectedOutput,
            monitorOutputDeviceId: monitorOutput || undefined,
            pitch,
            formant,
            chunkSize: chunk,
            mutePhysicalOutput: echoGuard,
            qualityMode,
          });
          showToast('Voice model switched and conversion restarted.', 'success');
        } else {
          await AudioEngineService.updateModel(modelId);
        }
      } catch (error) {
        if (error?.code !== 'MODEL_NOT_LOADED') {
          handleEngineError(error);
        }
      } finally {
        setEngineBusy(false);
      }
    },
    [chunk, echoGuard, formant, handleEngineError, isLive, monitorOutput, pitch, qualityMode, selectedInput, selectedModel, selectedOutput, showToast, voiceModels]
  );

  const handleModelImport = useCallback(
    async ({ modelFile, indexFile }) => {
      if (isLive) {
        showToast('Stop conversion before importing a model.', 'error');
        throw new Error('Engine is live.');
      }

      setEngineBusy(true);
      showToast('Optimizing model for CPU...', 'info');

      try {
        const result = await AudioEngineService.importAndOptimizeRvcModel({ modelFile, indexFile });
        const liveModels = AudioEngineService.getAvailableVoiceModels(result.info).map(decorateVoiceModel);

        setVoiceModels(liveModels);
        setSelectedModel(result.modelId);
        setPreferences((current) => ({ ...current, defaultModel: result.modelId }));
        showToast('RVC model optimized to ONNX and added to voices.', 'success');
        return result;
      } catch (error) {
        handleEngineError(error);
        throw error;
      } finally {
        setEngineBusy(false);
      }
    },
    [handleEngineError, isLive, showToast]
  );

  const handleInputSelect = useCallback(
    (deviceId) => {
      const device = audioDevices.inputs.find((item) => item.id === deviceId);
      if (device && isLoopbackInputDevice(device)) {
        showToast('That input captures speaker output. Choose a real microphone to stop repeated words.', 'error');
        return;
      }

      setRouteMode('advanced');
      setSelectedInput(deviceId);
    },
    [audioDevices.inputs, showToast]
  );

  const handleOutputSelect = useCallback(
    (deviceId) => {
      const device = audioDevices.outputs.find((item) => item.id === deviceId);
      setRouteMode('advanced');
      setSelectedOutput(deviceId);
      if (shouldMuteOutputDevice(device)) {
        setEchoGuard(true);
      }
    },
    [audioDevices.outputs]
  );

  const handleMonitorOutputSelect = useCallback((deviceId) => {
    setRouteMode('advanced');
    setMonitorOutput(deviceId);
  }, []);

  const handleUseStreamRoute = useCallback(() => {
    setRouteMode('stream');
    setSelectedInput(streamRoute.inputDeviceId || '');
    setSelectedOutput(streamRoute.streamOutputDeviceId || '');
    setMonitorOutput(streamRoute.monitorOutputDeviceId || '');
    setEchoGuard(false);
    showToast(streamRoute.virtualCableReady ? 'Automatic Stream Mode route applied.' : 'Install or repair VB-CABLE from Morphly setup to finish Stream Mode.', streamRoute.virtualCableReady ? 'success' : 'error');
  }, [showToast, streamRoute.inputDeviceId, streamRoute.monitorOutputDeviceId, streamRoute.streamOutputDeviceId, streamRoute.virtualCableReady]);

  const openVirtualCableSetup = useCallback(() => {
    const url = 'https://vb-audio.com/Cable/';
    if (window.electronAPI?.openExternal) {
      window.electronAPI.openExternal(url);
      return;
    }

    window.open(url, '_blank', 'noopener,noreferrer');
  }, []);

  const handlePitchChange = useCallback((value) => {
    settingsTouchedRef.current = true;
    setPitch(value);
  }, []);

  const handleFormantChange = useCallback((value) => {
    settingsTouchedRef.current = true;
    setFormant(value);
  }, []);

  const handleChunkChange = useCallback((value) => {
    settingsTouchedRef.current = true;
    setChunk(value);
  }, []);

  const handleQualityModeChange = useCallback((mode) => {
    const profile = voiceQualityProfiles[mode];
    if (!profile) {
      return;
    }

    settingsTouchedRef.current = true;
    setQualityMode(mode);
    setPitch(profile.pitch);
    setFormant(profile.formant);
    setChunk(profile.chunk);
    showToast(`${profile.label} voice mode applied.`, 'success');
  }, [showToast]);

  const handleRoutingPreset = useCallback(
    (preset) => {
      if (preset === 'headphones') {
        const headphones = findFirstOutputDevice(audioDevices.outputs, isHeadphoneOutputDevice);
        const mic = findFirstInputDevice(audioDevices.inputs);

        if (mic) {
          setSelectedInput(mic.id);
        }
        if (headphones) {
          setSelectedOutput(headphones.id);
          setEchoGuard(false);
          showToast('Headphones routing applied.', 'success');
          return;
        }

        setEchoGuard(true);
        showToast('No headphones output found. Speaker playback may feed back into the mic.', 'error');
        return;
      }

      if (preset === 'virtual') {
        const virtualOutput = findFirstOutputDevice(audioDevices.outputs, isVirtualOutputDevice);
        const mic = findFirstInputDevice(audioDevices.inputs);

        if (mic) {
          setSelectedInput(mic.id);
        }
        if (virtualOutput) {
          setSelectedOutput(virtualOutput.id);
          setEchoGuard(false);
          showToast('Virtual cable routing applied.', 'success');
          return;
        }

        setEchoGuard(true);
        showToast('No virtual cable output found.', 'error');
        return;
      }

      setEchoGuard(true);
      showToast('Safe Test routing applied.', 'success');
    },
    [audioDevices.inputs, audioDevices.outputs, showToast]
  );

  const handlePaymentSuccess = useCallback(
    async (plan, _response, profile) => {
      if (profile) {
        applyProfile(profile);
      }
      showToast(`${(plan.credits ?? 0).toLocaleString()} voice credits added.`, 'success');
    },
    [applyProfile, showToast]
  );

  const { startPayment, activePlanId, isPaymentConfigured } = useCreditTopUp({
    user,
    displayName,
    displayEmail,
    onPaymentSuccess: handlePaymentSuccess,
    onPaymentError: (message) => showToast(message, 'error'),
  });

  const renderView = () => {
    if (activeView === 'credits') {
      return (
        <CreditsView
          credits={normalizedCredits}
          plans={plans}
          onBuyPlan={startPayment}
          activePlanId={activePlanId}
          isPaymentConfigured={isPaymentConfigured}
        />
      );
    }

    if (activeView === 'settings') {
      return (
        <SettingsView
          displayName={displayName}
          displayEmail={displayEmail}
          credits={normalizedCredits}
          voiceModels={voiceModels}
          preferences={preferences}
          setPreferences={setPreferences}
          saveProfile={saveProfile}
          showToast={showToast}
        />
      );
    }

    return (
        <StudioView
        selectedInput={selectedInput}
        setSelectedInput={handleInputSelect}
        inputDevices={audioDevices.inputs}
        selectedInputLabel={selectedInputDevice?.label || 'No microphone selected'}
        selectedOutput={selectedOutput}
        setSelectedOutput={handleOutputSelect}
        outputDevices={audioDevices.outputs}
        selectedOutputLabel={selectedOutputDevice?.label || (streamRouteActive ? 'No virtual cable found' : 'No speaker selected')}
        monitorOutput={monitorOutput}
        setMonitorOutput={handleMonitorOutputSelect}
        monitorOutputLabel={monitorOutputDevice?.label || 'No local monitor'}
        routeMode={routeMode}
        setRouteMode={setRouteMode}
        streamRoute={streamRoute}
        useStreamRoute={handleUseStreamRoute}
        openVirtualCableSetup={openVirtualCableSetup}
        echoGuard={echoGuard}
        setEchoGuard={setEchoGuard}
        selectedOutputEchoProtected={selectedOutputEchoProtected}
        selectedInputIsLoopback={selectedInputIsLoopback}
        selectedOutputNeedsMute={selectedOutputNeedsMute}
        qualityMode={qualityMode}
        setQualityMode={handleQualityModeChange}
        onRoutingPreset={handleRoutingPreset}
        voiceModels={voiceModels}
        modelsLoading={modelsLoading}
        modelsError={modelsError}
        refreshModels={refreshModels}
        importModel={handleModelImport}
        selectedModel={selectedModel}
        setSelectedModel={handleModelSelect}
        pitch={pitch}
        setPitch={handlePitchChange}
        formant={formant}
        setFormant={handleFormantChange}
        chunk={chunk}
        setChunk={handleChunkChange}
        isLive={isLive}
        toggleEngine={toggleEngine}
        engineBusy={engineBusy}
        engineDisabled={!isMorphlyApiConfigured || normalizedCredits < CREDITS_PER_STARTED_MINUTE || !audioDevices.engineOnline || !selectedModel || !routeReady}
        engineOnline={audioDevices.engineOnline}
        devicesLoading={audioDevices.loading}
        deviceSource={audioDevices.source}
        deviceError={audioDevices.error}
        refreshDevices={audioDevices.refreshDevices}
        currentModel={currentModel}
        estimatedLatency={estimatedLatency}
      />
    );
  };

  return (
    <main className="app-shell h-screen w-screen overflow-hidden text-slate-100">
      <div className="flex h-full">
        <aside className={`flex shrink-0 flex-col border-r border-white/10 bg-black/28 px-3 py-4 transition-all duration-300 ${isSidebarCollapsed ? 'w-16' : 'w-56'}`}>
          <div className="mb-6 flex items-center justify-between px-1">
            {!isSidebarCollapsed && (
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded bg-teal-400/15 text-teal-200 ring-1 ring-teal-300/30">
                  <AudioWaveform size={18} />
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-teal-200">Morphly</p>
                  <p className="text-[10px] text-slate-500">Voice Console</p>
                </div>
              </div>
            )}
            <button
              onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
              className={`flex h-8 w-8 items-center justify-center rounded border border-white/10 text-slate-400 hover:bg-white/5 hover:text-slate-100 ${isSidebarCollapsed ? 'mx-auto' : ''}`}
              title={isSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              <Menu size={15} />
            </button>
          </div>

          <nav className="space-y-1.5">
            {navItems.map((item) => {
              const Icon = item.icon;
              const active = activeView === item.id;

              return (
                <button
                  key={item.id}
                  onClick={() => setActiveView(item.id)}
                  title={isSidebarCollapsed ? item.label : undefined}
                  className={`flex h-9 w-full items-center rounded px-2.5 text-xs font-medium transition ${
                    active
                      ? 'bg-teal-300/12 text-teal-100 ring-1 ring-teal-200/20'
                      : 'text-slate-400 hover:bg-white/[0.05] hover:text-slate-100'
                  } ${isSidebarCollapsed ? 'justify-center' : 'justify-between'}`}
                >
                  <span className="flex items-center gap-2">
                    <Icon size={16} />
                    {!isSidebarCollapsed && item.label}
                  </span>
                  {!isSidebarCollapsed && active && <ChevronRight size={14} />}
                </button>
              );
            })}
          </nav>

          <div className="mt-auto space-y-3">
            <div className="rounded border border-white/10 bg-white/[0.035] p-2.5">
              {!isSidebarCollapsed ? (
                <>
                  <div className="mb-1.5 flex items-center justify-between">
                    <span className="text-[10px] uppercase tracking-[0.15em] text-slate-500">Account</span>
                    <span className={`h-1.5 w-1.5 rounded-full ${user ? 'bg-teal-300 shadow-glow' : 'bg-slate-600'}`} />
                  </div>
                  <p className="truncate text-xs font-semibold">{displayEmail || 'Not signed in'}</p>
                  <p className="mt-0.5 text-[10px] text-amber-100">{normalizedCredits.toLocaleString()} credits</p>
                </>
              ) : (
                <div className="flex flex-col items-center gap-1">
                  <span className={`h-1.5 w-1.5 rounded-full ${user ? 'bg-teal-300' : 'bg-slate-600'}`} />
                  <span className="text-[9px] font-semibold text-amber-100">{normalizedCredits >= 1000 ? `${(normalizedCredits / 1000).toFixed(0)}k` : normalizedCredits}c</span>
                </div>
              )}
            </div>

            <div className="rounded border border-white/10 bg-white/[0.035] p-2.5">
              {!isSidebarCollapsed ? (
                <>
                  <div className="mb-1.5 flex items-center justify-between">
                    <span className="text-[10px] uppercase tracking-[0.15em] text-slate-500">Session</span>
                    <span className={`h-1.5 w-1.5 rounded-full ${isLive ? 'bg-teal-300 shadow-glow' : 'bg-slate-600'}`} />
                  </div>
                  <p className="truncate text-xs font-semibold">{currentModel.name}</p>
                  <p className="mt-0.5 text-[10px] text-slate-500">{isLive ? 'Active' : 'Idle'}</p>
                </>
              ) : (
                <div className="flex flex-col items-center gap-1">
                  <span className={`h-1.5 w-1.5 rounded-full ${isLive ? 'bg-teal-300' : 'bg-slate-600'}`} />
                  <span className="text-[9px] text-slate-500 font-semibold">V{currentModel.speaker}</span>
                </div>
              )}
            </div>

            <button
              onClick={handleSignOut}
              title={isSidebarCollapsed ? "Sign out" : undefined}
              className="flex h-9 w-full items-center justify-center gap-2 rounded border border-white/10 text-xs text-slate-400 transition hover:border-rose-300/30 hover:bg-rose-400/10 hover:text-rose-100"
            >
              <LogOut size={14} />
              {!isSidebarCollapsed && "Sign out"}
            </button>
          </div>
        </aside>

        <section className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <header className="flex h-14 shrink-0 items-center justify-between border-b border-white/10 px-5">
            <div>
              <h1 className="text-base font-semibold tracking-tight">{navItems.find((item) => item.id === activeView)?.label}</h1>
              <p className="text-[10px] text-slate-500">Real-time conversion over the local w-okada engine.</p>
            </div>
            <div className="flex items-center gap-2">
              <div className="rounded border border-amber-300/20 bg-amber-300/10 px-2.5 py-1 text-xs text-amber-100">
                {normalizedCredits.toLocaleString()} voice credits
              </div>
              <button className="flex h-8 w-8 items-center justify-center rounded border border-white/10 text-slate-400 transition hover:bg-white/5 hover:text-slate-100">
                <Moon size={15} />
              </button>
            </div>
          </header>

          <div className="min-h-0 flex-1 overflow-auto px-5 py-4">{renderView()}</div>
        </section>
      </div>

      {(!user || loading) && (
        <AuthPortal
          authMode={authMode}
          setAuthMode={setAuthMode}
          auth={auth}
          setAuth={setAuth}
          authTouched={authTouched}
          setAuthTouched={setAuthTouched}
          submitAuth={submitAuth}
          emailValid={emailValid}
          passwordValid={passwordValid}
          canSubmit={canSubmit}
          authBusy={authBusy || loading}
          authError={authError || authContextError}
          isSupabaseConfigured={isSupabaseConfigured}
          onGoogleAuth={handleGoogleAuth}
        />
      )}

      {toast && <Toast toast={toast} />}
    </main>
  );
}

function AuthPortal({
  authMode,
  setAuthMode,
  auth,
  setAuth,
  authTouched,
  setAuthTouched,
  submitAuth,
  emailValid,
  passwordValid,
  canSubmit,
  authBusy,
  authError,
  isSupabaseConfigured,
  onGoogleAuth,
}) {
  const isSignIn = authMode === 'signin';

  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/58 p-4 backdrop-blur-xl">
      <form onSubmit={submitAuth} className="glass w-full max-w-sm rounded p-5 shadow-2xl">
        <div className="mb-4 flex items-start justify-between">
          <div>
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded bg-teal-300/15 text-teal-100 ring-1 ring-teal-200/25">
              {isSignIn ? <LockKeyhole size={18} /> : <UserPlus size={18} />}
            </div>
            <h2 className="text-lg font-semibold">{isSignIn ? 'Sign In' : 'Create Account'}</h2>
            <p className="mt-0.5 text-xs text-slate-400">Access your Morphly voice workspace.</p>
          </div>
          <div className="flex rounded border border-white/10 bg-black/20 p-0.5 text-[10px]">
            {[
              ['signin', 'Sign In'],
              ['signup', 'Create Account'],
            ].map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                onClick={() => {
                  setAuthMode(mode);
                  setAuthTouched(false);
                }}
                className={`rounded px-2.5 py-1.5 font-medium transition ${
                  authMode === mode ? 'bg-white text-slate-950' : 'text-slate-400 hover:text-slate-100'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <button
          type="button"
          onClick={onGoogleAuth}
          className="mb-4 flex h-9 w-full items-center justify-center gap-2.5 rounded border border-white/12 bg-white/[0.04] text-xs font-medium transition hover:bg-white/[0.08]"
        >
          <span className="flex h-4 w-4 items-center justify-center rounded-full bg-white text-[10px] font-bold text-slate-950">G</span>
          Continue with Google
        </button>

        <div className="mb-3 space-y-3">
          <Field
            icon={Mail}
            label="Email"
            type="email"
            value={auth.email}
            placeholder="you@company.com"
            valid={!authTouched || emailValid}
            error="Enter a valid email."
            onChange={(value) => setAuth((current) => ({ ...current, email: value }))}
          />
          <Field
            icon={KeyRound}
            label="Password"
            type="password"
            value={auth.password}
            placeholder="Minimum 8 characters"
            valid={!authTouched || passwordValid}
            error="Use at least 8 characters."
            onChange={(value) => setAuth((current) => ({ ...current, password: value }))}
          />
        </div>

        {(!isSupabaseConfigured || authError) && (
          <div className="mb-3 rounded border border-amber-300/25 bg-amber-300/10 px-2.5 py-1.5 text-[10px] text-amber-100">
            {authError || 'Supabase credentials are missing. Add the Vite environment variables to enable authentication.'}
          </div>
        )}

        <button
          type="submit"
          disabled={!canSubmit || authBusy}
          className={`flex h-9 w-full items-center justify-center gap-1.5 rounded text-xs font-semibold transition ${
            canSubmit
              ? 'bg-teal-300 text-slate-950 shadow-glow hover:bg-teal-200'
              : 'bg-slate-700 text-slate-400'
          }`}
        >
          {authBusy ? 'Connecting...' : isSignIn ? 'Enter Studio' : 'Create Workspace'}
          <ChevronRight size={14} />
        </button>
      </form>
    </div>
  );
}

const Field = memo(function Field({ icon: Icon, label, type, value, placeholder, valid, error, onChange }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-300">{label}</span>
      <span
        className={`flex h-9 items-center gap-2.5 rounded border bg-black/20 px-2.5 transition ${
          valid ? 'border-white/10 focus-within:border-teal-300/50' : 'border-rose-300/60'
        }`}
      >
        <Icon size={14} className={valid ? 'text-slate-500' : 'text-rose-200'} />
        <input
          type={type}
          value={value}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
          className="w-full bg-transparent text-xs text-slate-100 outline-none placeholder:text-slate-600"
        />
        {!valid && <span className="h-1.5 w-1.5 rounded-full bg-rose-300" />}
      </span>
      {!valid && <span className="mt-1 block text-[10px] text-rose-200">{error}</span>}
    </label>
  );
});

const StudioView = memo(function StudioView({
  selectedInput,
  setSelectedInput,
  inputDevices,
  selectedInputLabel,
  selectedOutput,
  setSelectedOutput,
  outputDevices,
  selectedOutputLabel,
  monitorOutput,
  setMonitorOutput,
  monitorOutputLabel,
  routeMode,
  setRouteMode,
  streamRoute,
  useStreamRoute,
  openVirtualCableSetup,
  echoGuard,
  setEchoGuard,
  selectedOutputEchoProtected,
  selectedInputIsLoopback,
  selectedOutputNeedsMute,
  qualityMode,
  setQualityMode,
  onRoutingPreset,
  voiceModels,
  modelsLoading,
  modelsError,
  refreshModels,
  importModel,
  selectedModel,
  setSelectedModel,
  pitch,
  setPitch,
  formant,
  setFormant,
  chunk,
  setChunk,
  isLive,
  toggleEngine,
  engineBusy,
  engineDisabled,
  engineOnline,
  devicesLoading,
  deviceSource,
  deviceError,
  refreshDevices,
  currentModel,
  estimatedLatency,
}) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [voiceFilter, setVoiceFilter] = useState('all');
  const routeStatus = streamRoute?.routeHealth?.status || 'engine-offline';
  const routeReady = routeStatus === 'ready' || routeStatus === 'ready-no-monitor';
  const routeBadgeClass = routeReady
    ? 'border-teal-200/30 bg-teal-300/10 text-teal-100'
    : routeStatus === 'needs-virtual-cable'
      ? 'border-amber-200/30 bg-amber-300/10 text-amber-100'
      : 'border-rose-200/30 bg-rose-300/10 text-rose-100';
  const voiceCounts = useMemo(
    () => ({
      all: voiceModels.length,
      female: voiceModels.filter((model) => voiceGender(model) === 'female').length,
      male: voiceModels.filter((model) => voiceGender(model) === 'male').length,
    }),
    [voiceModels]
  );
  const groupedVoiceSections = useMemo(() => {
    return voiceSections
      .map((section) => ({
        ...section,
        models: voiceModels.filter((model) => voiceGroupMatches(model, section)),
      }))
      .filter((section) => {
        if (!section.models.length) {
          return false;
        }

        return voiceFilter === 'all' || section.gender === voiceFilter;
      });
  }, [voiceFilter, voiceModels]);

  return (
    <div className="grid grid-cols-[minmax(0,1.35fr)_minmax(300px,0.65fr)] gap-4">
      <section className="space-y-4">
        <section className="panel rounded p-3.5">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <div className="mb-1 flex items-center gap-2">
                <ShieldCheck size={15} className={routeReady ? 'text-teal-200' : 'text-amber-200'} />
                <h2 className="text-xs font-semibold uppercase tracking-[0.1em] text-slate-400">Stream Mode</h2>
                <span className={`rounded border px-2 py-0.5 text-[9px] font-semibold ${routeBadgeClass}`}>
                  {routeMode === 'stream' ? (routeReady ? 'Ready' : 'Setup Needed') : 'Advanced'}
                </span>
              </div>
              <p className="text-[11px] text-slate-500">
                {deviceError || streamRoute?.routeHealth?.message || 'Morphly chooses the cleanest route automatically.'}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {streamRoute?.needsVirtualCableInstall && (
                <button
                  type="button"
                  onClick={openVirtualCableSetup}
                  className="flex h-8 items-center rounded border border-amber-200/30 bg-amber-300/10 px-2.5 text-xs font-semibold text-amber-50 transition hover:bg-amber-300/16"
                >
                  Install / Repair VB-CABLE
                </button>
              )}
              <button
                onClick={refreshDevices}
                disabled={isLive || engineBusy || devicesLoading}
                className="flex h-8 items-center gap-1.5 rounded border border-white/10 px-2.5 text-xs text-slate-300 transition hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <RefreshCw size={13} className={devicesLoading ? 'animate-spin' : ''} />
                Refresh
              </button>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2.5">
            <RouteTile icon={Mic2} label="Microphone" value={selectedInputLabel} tone={selectedInputIsLoopback ? 'warn' : 'ok'} />
            <RouteTile icon={AudioWaveform} label="Streaming mic" value={selectedOutputLabel} tone={streamRoute?.virtualCableReady || routeMode === 'advanced' ? 'ok' : 'warn'} />
            <RouteTile icon={Volume2} label="Local monitor" value={monitorOutputLabel} tone={monitorOutput ? 'warn' : 'muted'} />
          </div>

          <div className="mt-3 flex items-center justify-between gap-3 rounded border border-amber-300/25 bg-amber-300/10 px-3 py-2 text-[10px] text-amber-50">
            <span>Speaker monitoring can feed back into the laptop microphone. Keep the volume low or use headphones when possible.</span>
            <button
              type="button"
              onClick={() => setAdvancedOpen((current) => !current)}
              className="shrink-0 rounded border border-white/10 px-2 py-1 text-[10px] font-semibold text-slate-100 transition hover:bg-white/[0.06]"
            >
              {advancedOpen ? 'Hide Advanced' : 'Advanced'}
            </button>
          </div>

          {advancedOpen && (
            <div className="mt-3 rounded border border-white/10 bg-black/18 p-3">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold text-slate-200">Manual route recovery</p>
                  <p className="text-[10px] text-slate-500">Use this only when the automatic route chooses the wrong device.</p>
                </div>
                <button
                  type="button"
                  onClick={useStreamRoute}
                  disabled={isLive || engineBusy}
                  className="rounded border border-teal-200/30 bg-teal-300/10 px-2.5 py-1.5 text-[10px] font-semibold text-teal-50 transition hover:bg-teal-300/16 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Use Auto Route
                </button>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <DeviceSelect icon={Mic2} label="Microphone" value={selectedInput} options={inputDevices} onChange={setSelectedInput} placeholder="Select microphone" disabled={isLive || engineBusy} />
                <DeviceSelect icon={AudioWaveform} label="Stream Output" value={selectedOutput} options={outputDevices} onChange={setSelectedOutput} placeholder="Select virtual cable" disabled={isLive || engineBusy} />
                <DeviceSelect icon={Volume2} label="Monitor Speaker" value={monitorOutput} options={outputDevices.filter((device) => !device.id || !isVirtualOutputDevice(device))} onChange={setMonitorOutput} placeholder="No monitor" disabled={isLive || engineBusy} />
              </div>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={() => setRouteMode('stream')}
                  disabled={isLive || engineBusy}
                  className={`rounded px-2.5 py-1.5 text-[10px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${routeMode === 'stream' ? 'bg-teal-300 text-slate-950' : 'border border-white/10 text-slate-300 hover:bg-white/[0.06]'}`}
                >
                  Stream
                </button>
                <button
                  type="button"
                  onClick={() => setRouteMode('advanced')}
                  disabled={isLive || engineBusy}
                  className={`rounded px-2.5 py-1.5 text-[10px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${routeMode === 'advanced' ? 'bg-slate-200 text-slate-950' : 'border border-white/10 text-slate-300 hover:bg-white/[0.06]'}`}
                >
                  Advanced
                </button>
              </div>
            </div>
          )}
        </section>

        <section className="panel rounded p-3.5">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h2 className="text-xs font-semibold uppercase tracking-[0.1em] text-slate-400">Backend Voices</h2>
              <p className="text-xs text-slate-200">{currentModel.name} - <span className="text-slate-500">{currentModel.accent}</span></p>
            </div>
            <div className="flex items-center gap-2">
              <div className="rounded border border-teal-200/20 bg-teal-300/10 px-2 py-0.5 text-[9px] font-semibold text-teal-100">
                {voiceModels.length} live voices
              </div>
              <button
                onClick={refreshModels}
                disabled={isLive || engineBusy || modelsLoading}
                className="flex h-7 w-7 items-center justify-center rounded border border-white/10 text-slate-400 transition hover:bg-white/[0.06] hover:text-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                title="Refresh backend voices"
              >
                <RefreshCw size={13} className={modelsLoading ? 'animate-spin' : ''} />
              </button>
            </div>
          </div>

          {modelsError && (
            <div className="mb-3 rounded border border-amber-300/25 bg-amber-300/10 px-2.5 py-1.5 text-[10px] text-amber-100">
              {modelsError}
            </div>
          )}

          <div className="mb-3 flex flex-wrap gap-2">
            {voiceFilterTabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setVoiceFilter(tab.id)}
                className={`rounded border px-2.5 py-1.5 text-[10px] font-semibold transition ${
                  voiceFilter === tab.id
                    ? 'border-teal-200/50 bg-teal-300/15 text-teal-50'
                    : 'border-white/10 text-slate-400 hover:bg-white/[0.06] hover:text-slate-100'
                }`}
              >
                {tab.label} <span className="text-slate-500">{voiceCounts[tab.id] || 0}</span>
              </button>
            ))}
          </div>

          <div className="max-h-[22rem] space-y-3 overflow-auto pr-1">
            {groupedVoiceSections.map((section) => (
              <div key={section.id}>
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-400">{section.title}</h3>
                  <span className="rounded border border-white/10 px-2 py-0.5 text-[9px] text-slate-500">{section.models.length}</span>
                </div>
                <div className="grid grid-cols-3 gap-2.5">
                  {section.models.map((model) => {
                    const Icon = model.icon;
                    const active = model.id === selectedModel;
                    const needsOnnx = requiresOnnxOptimization(model);
                    const disabled = engineBusy || isLive || active;

                    return (
                      <button
                        key={model.id}
                        onClick={() => setSelectedModel(model.id)}
                        disabled={disabled}
                        title={needsOnnx ? 'Model must be optimized to ONNX for CPU execution' : isLive ? 'Stop conversion before switching voices' : model.name}
                        className={`rounded border p-2.5 text-left transition disabled:cursor-not-allowed disabled:opacity-60 ${
                          active
                            ? 'border-teal-200/60 bg-teal-300/10 shadow-glow'
                            : needsOnnx
                              ? 'border-amber-300/30 bg-amber-300/[0.06] hover:border-amber-200/40 hover:bg-amber-300/[0.09]'
                              : 'border-white/10 bg-white/[0.035] hover:border-white/20 hover:bg-white/[0.06]'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded bg-gradient-to-br ${model.color} text-slate-950`}>
                            <Icon size={14} />
                          </span>
                          <div className="min-w-0">
                            <span className="block truncate text-xs font-semibold">{model.name}</span>
                            <span className="block truncate text-[9px] text-slate-500">{model.voiceGenderLabel || section.title}</span>
                            <span className="block text-[9px] text-slate-500">slot {model.slot} - speaker {model.speaker}</span>
                            {needsOnnx && <span className="block truncate text-[9px] font-medium text-amber-100">ONNX required</span>}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
            {!groupedVoiceSections.length && (
              <div className="rounded border border-white/10 bg-white/[0.035] px-3 py-4 text-center text-xs text-slate-500">
                No voices in this group.
              </div>
            )}
          </div>
        </section>

        <section className="grid grid-cols-2 gap-3.5">
          <div className="panel rounded p-3.5">
            <div className="mb-3 flex items-center gap-2">
              <SlidersHorizontal size={14} className="text-teal-200" />
              <h2 className="text-xs font-semibold uppercase tracking-[0.1em] text-slate-400">Tone</h2>
            </div>
            <Slider label="Pitch Shift" value={pitch} min={-12} max={12} step={1} suffix="st" onChange={setPitch} />
            <Slider label="Formant Shift" value={formant} min={-2} max={2} step={0.5} suffix="" onChange={setFormant} />
          </div>

          <div className="panel rounded p-3.5">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Gauge size={14} className="text-amber-200" />
                <h2 className="text-xs font-semibold uppercase tracking-[0.1em] text-slate-400">Performance</h2>
              </div>
              <span className="text-xs text-amber-100 font-semibold">{estimatedLatency} ms buffer</span>
            </div>
            <div className="mb-3 grid grid-cols-1 gap-1 rounded border border-white/10 bg-black/18 p-1">
              {Object.entries(voiceQualityProfiles).map(([mode, profile]) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setQualityMode(mode)}
                  disabled={engineBusy}
                  className={`rounded px-2 py-1.5 text-left text-[10px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${
                    qualityMode === mode ? 'bg-amber-200 text-slate-950' : 'text-slate-400 hover:bg-white/[0.06] hover:text-slate-100'
                  }`}
                >
                  <span className="block">{profile.label}</span>
                  <span className={`block text-[9px] ${qualityMode === mode ? 'text-slate-700' : 'text-slate-600'}`}>{profile.accent}</span>
                </button>
              ))}
            </div>
            <Slider
              label="Chunk Size"
              value={chunk}
              min={64}
              max={512}
              step={16}
              suffix="chunks"
              onChange={setChunk}
              disabled={engineBusy}
              help="Higher values give Beatrice more stable audio buffering and help prevent crackle."
              showInput
            />
            <div className="mt-2 flex justify-between text-[9px] text-slate-500">
              <span>Latency</span>
              <span>Quality</span>
            </div>
          </div>
        </section>
      </section>

      <aside className="space-y-4">
        <section className="panel rounded p-3.5">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h2 className="text-xs font-semibold uppercase tracking-[0.1em] text-slate-400">Engine</h2>
              <p className="text-[11px] text-slate-500">
                {!engineOnline
                  ? 'Engine offline'
                  : !selectedModel
                    ? 'No voices loaded'
                    : !selectedInput || !selectedOutput
                      ? routeMode === 'stream' ? 'Set up stream route' : 'Choose audio devices'
                      : !isMorphlyApiConfigured
                        ? 'Cloud API required'
                      : engineDisabled
                        ? 'Credits required'
                        : isLive
                          ? 'Streaming live'
                          : 'Ready'}
              </p>
            </div>
            <span className={`rounded px-2 py-0.5 text-[9px] font-semibold ${isLive ? 'bg-teal-300/15 text-teal-100' : engineOnline ? 'bg-slate-700/60 text-slate-400' : 'bg-rose-400/10 text-rose-100'}`}>
              {isLive ? 'Active' : engineOnline ? 'Idle' : 'Offline'}
            </span>
          </div>

          <div className="mb-3 flex items-center gap-2 rounded border border-amber-300/30 bg-amber-300/10 px-3 py-2 text-xs font-semibold text-amber-50">
            <Headphones size={15} className="shrink-0 text-amber-100" />
            <span>Other apps should choose the virtual cable recording device as their microphone. Speaker monitor can echo if volume is high.</span>
          </div>

          <button
            onClick={toggleEngine}
            disabled={engineBusy || (engineDisabled && !isLive)}
            className={`mb-4 flex h-24 w-full flex-col items-center justify-center gap-2 rounded border text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${
              isLive
                ? 'border-rose-300/40 bg-rose-400/12 text-rose-50 shadow-[0_0_24px_rgba(251,113,133,0.18)]'
                : 'border-teal-300/40 bg-teal-300/12 text-teal-50 shadow-glow hover:bg-teal-300/18'
            }`}
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-black/28 ring-1 ring-white/10">
              {isLive ? <Square size={14} /> : <Play size={15} />}
            </span>
            {engineBusy
              ? 'Syncing Engine...'
              : !engineOnline
                ? 'Engine Offline'
                : !selectedModel
                  ? 'No Voices Loaded'
                : !selectedInput || !selectedOutput
                    ? routeMode === 'stream' ? 'Install Virtual Cable' : 'Choose Audio Devices'
                    : !isMorphlyApiConfigured
                      ? 'Cloud API Required'
                    : engineDisabled && !isLive
                      ? 'Add Credits To Start'
                      : isLive
                        ? 'Stop Conversion'
                        : 'Start Conversion'}
          </button>

          <Visualizer active={isLive} />
        </section>

        <section className="panel rounded p-3.5">
          <div className="mb-3 flex items-center gap-2">
            <Zap size={14} className="text-lime-200" />
            <h2 className="text-xs font-semibold uppercase tracking-[0.1em] text-slate-400">Signal Path</h2>
          </div>
          <PathRow icon={Mic2} label={selectedInputLabel} state="Input" />
          <PathRow icon={Bot} label={currentModel.name} state={`Speaker ${currentModel.speaker}`} />
          <PathRow icon={AudioWaveform} label={selectedOutputLabel} state="Virtual mic output" />
          <PathRow icon={Volume2} label={monitorOutputLabel} state="Local monitor" />
        </section>
      </aside>
    </div>
  );
});

const ModelImporter = memo(function ModelImporter({ onImport, disabled = false }) {
  const [modelFile, setModelFile] = useState(null);
  const [indexFile, setIndexFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const canImport = Boolean(modelFile) && !disabled && !busy;

  const submit = async () => {
    if (!modelFile || !canImport) {
      return;
    }

    setBusy(true);
    setError('');

    try {
      await onImport({ modelFile, indexFile });
      setModelFile(null);
      setIndexFile(null);
    } catch (importError) {
      setError(importError?.message || 'Model optimization failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel rounded p-3.5">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Upload size={14} className="text-teal-200" />
          <h2 className="text-xs font-semibold uppercase tracking-[0.1em] text-slate-400">Model Importer</h2>
        </div>
        <span className="rounded border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[9px] text-slate-400">RVC to ONNX</span>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-2.5">
        <FilePicker label=".pth model" accept=".pth" file={modelFile} onChange={setModelFile} disabled={disabled || busy} />
        <FilePicker label=".index file" accept=".index" file={indexFile} onChange={setIndexFile} disabled={disabled || busy} optional />
        <button
          type="button"
          onClick={submit}
          disabled={!canImport}
          className="flex h-11 min-w-44 items-center justify-center gap-1.5 rounded border border-teal-300/35 bg-teal-300/12 px-3 text-xs font-semibold text-teal-50 transition hover:bg-teal-300/18 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Cpu size={14} />
          {busy ? 'Optimizing model for CPU...' : 'Import ONNX'}
        </button>
      </div>

      {error && <p className="mt-2 text-[10px] text-rose-200">{error}</p>}
    </section>
  );
});

const FilePicker = memo(function FilePicker({ label, accept, file, onChange, disabled = false, optional = false }) {
  const inputId = useMemo(() => `${label.replace(/[^a-z0-9]/gi, '-').toLowerCase()}-${Math.random().toString(36).slice(2)}`, [label]);

  return (
    <label htmlFor={inputId} className="block rounded border border-white/10 bg-white/[0.035] p-2.5">
      <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-500">
        {label}{optional ? ' optional' : ''}
      </span>
      <span className="block truncate text-xs text-slate-200">{file?.name || 'Choose file'}</span>
      <input
        id={inputId}
        type="file"
        accept={accept}
        disabled={disabled}
        onChange={(event) => onChange(event.target.files?.[0] || null)}
        className="sr-only"
      />
    </label>
  );
});

const DeviceSelect = memo(function DeviceSelect({ icon: Icon, label, value, options, onChange, placeholder, disabled = false }) {
  const selectableOptions = options.filter((option) => option.id);
  const emptyLabel = selectableOptions.length ? placeholder : options.find((option) => !option.id)?.label || placeholder;

  return (
    <label className="panel block rounded p-2.5">
      <span className="mb-2 flex items-center gap-1.5 text-xs font-medium text-slate-300">
        <Icon size={14} className="text-teal-200" />
        {label}
      </span>
      <select
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="h-8 w-full rounded border border-white/10 bg-slate-950/60 px-2 py-1 text-xs text-slate-100 outline-none transition focus:border-teal-300/50 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <option value="">{emptyLabel}</option>
        {selectableOptions.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
});

const Slider = memo(function Slider({ label, value, min, max, step, suffix, onChange, disabled = false, help = '', showInput = false }) {
  const updateValue = (nextValue) => {
    const next = Number(nextValue);
    if (Number.isFinite(next)) {
      onChange(Math.min(max, Math.max(min, next)));
    }
  };

  return (
    <div className="mb-3 last:mb-0">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-xs text-slate-300">
          {label}
          {help && (
            <span className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-white/10 text-slate-500" title={help}>
              <Info size={10} />
            </span>
          )}
        </span>
        {showInput ? (
          <span className="flex items-center gap-1 rounded border border-white/10 bg-white/[0.04] px-1.5 py-0.5 text-[10px] text-slate-200">
            <input
              type="number"
              min={min}
              max={max}
              step={step}
              value={value}
              disabled={disabled}
              onChange={(event) => updateValue(event.target.value)}
              className="h-5 w-14 bg-transparent text-right text-[10px] text-slate-100 outline-none disabled:cursor-not-allowed"
            />
            <span>{suffix}</span>
          </span>
        ) : (
          <span className="rounded border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] text-slate-200">
            {value > 0 && min < 0 ? '+' : ''}
            {value} {suffix}
          </span>
        )}
      </div>
      <input
        type="range"
        className="range w-full disabled:cursor-not-allowed disabled:opacity-50"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(event) => updateValue(event.target.value)}
      />
    </div>
  );
});

const Visualizer = memo(function Visualizer({ active }) {
  return (
    <div className="rounded border border-white/10 bg-black/24 p-2.5">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-medium">Live Visualizer</span>
        <span className="text-[10px] text-slate-500">{active ? '-18 dB' : 'muted'}</span>
      </div>
      <div className={`flex h-20 items-center gap-1 overflow-hidden rounded bg-slate-950/50 px-2.5 ${active ? 'wave-active' : 'opacity-45'}`}>
        {bars.map((height, index) => (
          <span
            key={`wave-${index}`}
            className="wave-bar block flex-1 origin-center rounded-full bg-gradient-to-t from-teal-400 via-lime-200 to-amber-200"
            style={{
              height: `${height}%`,
              animationDelay: `${index * 52}ms`,
            }}
          />
        ))}
      </div>
    </div>
  );
});

function RouteTile({ icon: Icon, label, value, tone = 'ok' }) {
  const toneClass =
    tone === 'ok'
      ? 'border-teal-200/20 bg-teal-300/10 text-teal-100'
      : tone === 'warn'
        ? 'border-amber-200/25 bg-amber-300/10 text-amber-100'
        : 'border-white/10 bg-white/[0.03] text-slate-400';

  return (
    <div className={`min-w-0 rounded border p-2.5 ${toneClass}`}>
      <div className="mb-1 flex items-center gap-1.5">
        <Icon size={13} className="shrink-0" />
        <span className="text-[10px] font-semibold uppercase tracking-[0.1em]">{label}</span>
      </div>
      <p className="truncate text-xs font-medium text-slate-100">{value}</p>
    </div>
  );
}

function PathRow({ icon: Icon, label, state }) {
  return (
    <div className="mb-2 flex items-center gap-2.5 rounded border border-white/10 bg-white/[0.03] p-2 last:mb-0">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-white/[0.05] text-slate-300">
        <Icon size={13} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium">{label}</p>
        <p className="text-[10px] text-slate-500">{state}</p>
      </div>
      <Check size={13} className="text-teal-200" />
    </div>
  );
}

const CreditsView = memo(function CreditsView({ credits, plans, onBuyPlan, activePlanId, isPaymentConfigured }) {
  return (
    <div className="space-y-4">
      <section className="grid grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] gap-3.5">
        <div className="panel rounded p-4">
          <div className="mb-3.5 flex items-center justify-between">
            <div>
              <p className="text-xs text-slate-500">Current Balance</p>
              <h2 className="mt-1 text-3xl font-semibold tracking-tight">{credits.toLocaleString()}</h2>
              <p className="mt-1 text-[11px] text-teal-100">Voice credits available</p>
            </div>
            <div className="flex h-12 w-12 items-center justify-center rounded bg-amber-300/12 text-amber-100 ring-1 ring-amber-200/20">
              <CircleDollarSign size={20} />
            </div>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-slate-800">
            <div className="h-full rounded-full bg-gradient-to-r from-teal-300 to-amber-300" style={{ width: `${Math.min(100, credits / 20)}%` }} />
          </div>
          <div className="mt-2 flex justify-between text-[10px] text-slate-500">
            <span>Monthly usage</span>
            <span>{Math.min(100, Math.round(credits / 20))}%</span>
          </div>
        </div>

        <div className="panel rounded p-4">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <p className="text-xs text-slate-500">Usage Analytics</p>
              <h2 className="mt-1 text-base font-semibold">May conversion load</h2>
            </div>
            <span className={`rounded border px-2 py-0.5 text-[10px] ${isPaymentConfigured ? 'border-teal-200/20 bg-teal-300/10 text-teal-100' : 'border-amber-300/20 bg-amber-300/10 text-amber-100'}`}>
              {isPaymentConfigured ? 'Flutterwave ready' : 'Setup needed'}
            </span>
          </div>
          <div className="flex h-22 items-end gap-2">
            {[38, 52, 47, 72, 61, 84, 76, 91, 67, 74, 88, 64].map((height, index) => (
              <div key={`usage-${index}`} className="flex flex-1 flex-col items-center gap-1.5">
                <span className="w-full rounded-t bg-gradient-to-t from-teal-500/80 to-amber-200" style={{ height: `${height}%` }} />
                <span className="text-[9px] text-slate-600">{index + 1}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="grid grid-cols-3 gap-3.5">
        {plans.map((plan) => (
          <article
            key={plan.id}
            className={`panel rounded p-4 ${plan.featured ? 'border-teal-200/45 bg-teal-300/[0.07]' : ''}`}
          >
            <div className="mb-4 flex items-start justify-between">
              <div>
                <h3 className="text-base font-semibold">{plan.name}</h3>
                <p className="mt-0.5 text-xs text-slate-500">{plan.accent}</p>
              </div>
              {plan.featured && <span className="rounded bg-teal-300 px-1.5 py-0.5 text-[9px] font-semibold text-slate-950">Popular</span>}
            </div>
            <p className="mb-1 text-2xl font-semibold">{plan.priceDisplay}</p>
              <p className="mb-3.5 text-xs text-slate-400">{plan.credits.toLocaleString()} voice credits</p>
            <div className="mb-4 h-1.5 overflow-hidden rounded-full bg-slate-800">
              <div className="h-full rounded-full bg-gradient-to-r from-teal-300 to-amber-300" style={{ width: `${plan.meter}%` }} />
            </div>
            <button
              onClick={() => onBuyPlan(plan)}
              disabled={activePlanId === plan.id}
              className="flex h-9 w-full items-center justify-center gap-1.5 rounded bg-white text-xs font-semibold text-slate-950 transition hover:bg-teal-100 disabled:cursor-wait disabled:opacity-70"
            >
              <ShieldCheck size={14} />
              {activePlanId === plan.id ? 'Opening checkout...' : 'Pay securely'}
            </button>
          </article>
        ))}
      </section>

      <section className="panel rounded p-3.5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold">Flutterwave Checkout</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              {isPaymentConfigured ? 'Card, bank transfer, and USSD checkout in local currency.' : 'Add VITE_MORPHLY_API_URL and Flutterwave keys to enable live checkout.'}
            </p>
          </div>
          <div className="flex items-center gap-2 rounded border border-white/10 bg-white/[0.035] px-3 py-2">
            <CreditCard size={15} className="text-teal-200" />
            <span className="text-xs font-medium">Flutterwave</span>
          </div>
        </div>
      </section>
    </div>
  );
});

function SettingsView({ displayName, displayEmail, credits, voiceModels, preferences, setPreferences, saveProfile, showToast }) {
  const [profileForm, setProfileForm] = useState({ name: displayName, email: displayEmail });

  useEffect(() => {
    setProfileForm({ name: displayName, email: displayEmail });
  }, [displayEmail, displayName]);

  const save = async () => {
    try {
      await saveProfile({ display_name: profileForm.name, email: profileForm.email });
      showToast('Profile updated.', 'success');
    } catch (error) {
      showToast(error.message || 'Unable to update profile.', 'error');
    }
  };

  return (
    <div className="grid grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)] gap-3.5">
      <section className="space-y-3.5">
        <div className="panel rounded p-3.5">
          <div className="mb-3.5 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <User size={15} className="text-teal-200" />
              <h2 className="text-sm font-semibold">Profile</h2>
            </div>
            <span className="rounded border border-amber-300/20 bg-amber-300/10 px-2 py-0.5 text-[10px] text-amber-100">
              {credits.toLocaleString()} credits
            </span>
          </div>
          <SettingsInput label="Display Name" value={profileForm.name} onChange={(value) => setProfileForm((current) => ({ ...current, name: value }))} />
          <SettingsInput label="Email" value={profileForm.email} onChange={(value) => setProfileForm((current) => ({ ...current, email: value }))} />
          <button onClick={save} className="mt-1.5 h-8 rounded bg-white px-3 text-xs font-semibold text-slate-950 hover:bg-teal-100">
            Save profile
          </button>
        </div>

        <div className="panel rounded p-3.5">
          <div className="mb-3.5 flex items-center gap-2">
            <KeyRound size={15} className="text-amber-200" />
            <h2 className="text-sm font-semibold">API Key</h2>
          </div>
          <div className="mb-3 flex items-center gap-2 rounded border border-white/10 bg-slate-950/60 px-2.5 py-1.5">
            <code className="min-w-0 flex-1 truncate text-xs text-slate-300">morph_sk_live_9nQx...7R4c</code>
            <button className="flex h-7 w-7 items-center justify-center rounded bg-white/[0.06] text-slate-300 hover:bg-white/[0.1]">
              <Copy size={13} />
            </button>
          </div>
          <button className="flex h-8 items-center gap-1.5 rounded border border-white/10 px-3 text-xs font-medium text-slate-200 hover:bg-white/[0.05]">
            <RefreshCw size={13} />
            Rotate key
          </button>
        </div>
      </section>

      <section className="panel rounded p-3.5">
        <div className="mb-4 flex items-center gap-2">
          <Power size={15} className="text-lime-200" />
          <h2 className="text-sm font-semibold">App Preferences</h2>
        </div>
        <ToggleRow
          label="Start on boot"
          description="Launch Morphly with the desktop wrapper"
          checked={preferences.boot}
          onChange={(value) => setPreferences((current) => ({ ...current, boot: value }))}
        />
        <ToggleRow
          label="Light mode"
          description="Use a brighter interface palette"
          checked={preferences.lightMode}
          onChange={(value) => setPreferences((current) => ({ ...current, lightMode: value }))}
        />
        <ToggleRow
          label="Performance reports"
          description="Share local latency and crash diagnostics"
          checked={preferences.telemetry}
          onChange={(value) => setPreferences((current) => ({ ...current, telemetry: value }))}
        />
        <label className="mt-4 block">
          <span className="mb-1.5 block text-xs font-medium text-slate-300">Default Model</span>
          <select
            value={preferences.defaultModel}
            onChange={(event) => setPreferences((current) => ({ ...current, defaultModel: event.target.value }))}
            className="h-8 w-full rounded border border-white/10 bg-slate-950/60 px-2.5 text-xs text-slate-100 outline-none focus:border-teal-300/50"
          >
            {!voiceModels.length && <option value="">No backend voices loaded</option>}
            {voiceModels.map((model) => (
              <option key={model.id} value={model.id}>
                {model.voiceFamilyLabel || 'Voice'} - {model.voiceGenderLabel || 'Unlabeled'} - {model.name} (speaker {model.speaker})
              </option>
            ))}
          </select>
        </label>
      </section>
    </div>
  );
}

function SettingsInput({ label, value, onChange }) {
  return (
    <label className="mb-3 block">
      <span className="mb-1.5 block text-xs font-medium text-slate-300">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-8 w-full rounded border border-white/10 bg-slate-950/60 px-2.5 text-xs text-slate-100 outline-none transition focus:border-teal-300/50"
      />
    </label>
  );
}

function ToggleRow({ label, description, checked, onChange }) {
  return (
    <div className="mb-2.5 flex items-center justify-between rounded border border-white/10 bg-white/[0.03] p-2.5 last:mb-0">
      <div>
        <p className="text-xs font-medium">{label}</p>
        <p className="mt-0.5 text-[10px] text-slate-500">{description}</p>
      </div>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className={`relative h-5 w-9 shrink-0 rounded-full transition ${checked ? 'bg-teal-300' : 'bg-slate-700'}`}
      >
        <span className={`absolute top-0.5 h-3.5 w-3.5 rounded-full bg-white transition ${checked ? 'left-[18px] text-slate-950' : 'left-[3px]'}`} />
      </button>
    </div>
  );
}

function Toast({ toast }) {
  return (
    <div className="fixed bottom-5 right-5 z-[60] max-w-sm rounded border border-white/10 bg-slate-950/95 px-4 py-3 shadow-2xl">
      <p className={`text-sm font-medium ${toast.tone === 'error' ? 'text-rose-100' : toast.tone === 'success' ? 'text-teal-100' : 'text-slate-100'}`}>
        {toast.message}
      </p>
    </div>
  );
}

export default App;
