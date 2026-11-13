import { useCallback, useEffect, useRef, useState } from 'react';
import { NativeModules } from 'react-native';
import { supabase } from '../../lib/supabase';

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

export default function useDirectCall({
  conversationId,
  currentUserId,
  peerUserId,
  enabled,
}) {
  const [call, setCall] = useState(null);
  const [localStream, setLocalStream] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);
  const [channelReady, setChannelReady] = useState(false);
  const [callError, setCallError] = useState('');
  const [rtcView, setRtcView] = useState(null);
  const callRef = useRef(null);
  const channelRef = useRef(null);
  const peerConnectionRef = useRef(null);
  const peerCreationRef = useRef(null);
  const localStreamRef = useRef(null);
  const pendingOfferRef = useRef(null);
  const pendingCandidatesRef = useRef([]);
  const acceptingRef = useRef(false);
  const timeoutRef = useRef(null);
  const signalHandlerRef = useRef(null);
  const webRTCRef = useRef(null);

  const loadWebRTC = useCallback(async () => {
    if (webRTCRef.current) return webRTCRef.current;

    if (!NativeModules.WebRTCModule) {
      throw new Error(
        'Voice and video calls are not available in Expo Go. Install the SocialApp development build to use calls.'
      );
    }

    let importedModule;
    try {
      importedModule = await import('react-native-webrtc');
    } catch {
      throw new Error(
        'Voice and video calls require the SocialApp development build. Expo Go does not include WebRTC.'
      );
    }

    const webRTC = importedModule.default?.mediaDevices
      ? importedModule.default
      : importedModule;

    if (typeof webRTC.mediaDevices?.getUserMedia !== 'function') {
      throw new Error(
        'WebRTC media capture is unavailable. Rebuild and reinstall the SocialApp development build, then try again.'
      );
    }

    webRTCRef.current = webRTC;
    setRtcView(() => webRTC.RTCView);
    return webRTC;
  }, []);

  const updateCall = useCallback((nextCall) => {
    callRef.current = nextCall;
    setCall(nextCall);
  }, []);

  const clearCallTimeout = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const cleanupCall = useCallback(() => {
    clearCallTimeout();
    acceptingRef.current = false;
    pendingOfferRef.current = null;
    pendingCandidatesRef.current = [];

    peerConnectionRef.current?.close();
    peerConnectionRef.current = null;
    peerCreationRef.current = null;

    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;
    setLocalStream(null);
    setRemoteStream(null);
    updateCall(null);
  }, [clearCallTimeout, updateCall]);

  const sendSignal = useCallback(async (signal) => {
    const channel = channelRef.current;
    if (!channel || !callRef.current?.id) {
      throw new Error('The secure call connection is not ready.');
    }

    const status = await channel.send({
      type: 'broadcast',
      event: 'signal',
      payload: {
        ...signal,
        callId: callRef.current.id,
        from: currentUserId,
      },
    });

    if (status !== 'ok') {
      throw new Error('Could not send call signal. Please try again.');
    }
  }, [currentUserId]);

  const addPendingCandidates = useCallback(async (peer) => {
    const candidates = pendingCandidatesRef.current.splice(0);
    if (!candidates.length) return;
    const webRTC = await loadWebRTC();
    await Promise.all(
      candidates.map((candidate) =>
        peer.addIceCandidate(new webRTC.RTCIceCandidate(candidate))
      )
    );
  }, [loadWebRTC]);

  const createPeerConnection = useCallback(async (mediaType) => {
    if (peerConnectionRef.current) return peerConnectionRef.current;
    if (peerCreationRef.current) return peerCreationRef.current;

    const callId = callRef.current?.id;
    const creation = (async () => {
      const webRTC = await loadWebRTC();
      const stream = await webRTC.mediaDevices.getUserMedia({
        audio: true,
        video: mediaType === 'video' ? { facingMode: 'user' } : false,
      });

      if (!callId || callRef.current?.id !== callId) {
        stream.getTracks().forEach((track) => track.stop());
        throw new Error('The call ended before the connection was ready.');
      }

      const peer = new webRTC.RTCPeerConnection({ iceServers: ICE_SERVERS });
      peerConnectionRef.current = peer;
      localStreamRef.current = stream;
      setLocalStream(stream);

      stream.getTracks().forEach((track) => peer.addTrack(track, stream));

      peer.ontrack = (event) => {
        const [incomingStream] = event.streams || [];
        if (incomingStream) setRemoteStream(incomingStream);
      };

      peer.onicecandidate = (event) => {
        if (!event.candidate || !callRef.current) return;
        sendSignal({
          type: 'candidate',
          candidate: event.candidate.toJSON(),
        }).catch((error) => {
          console.warn('Could not send call candidate:', error.message);
        });
      };

      peer.onconnectionstatechange = () => {
        if (peer.connectionState === 'connected') {
          clearCallTimeout();
          const current = callRef.current;
          if (current) updateCall({ ...current, phase: 'connected' });
        } else if (peer.connectionState === 'failed') {
          setCallError(
            'The peer-to-peer connection failed. Check your network and try again.'
          );
          cleanupCall();
        }
      };

      return peer;
    })();

    peerCreationRef.current = creation;
    try {
      return await creation;
    } finally {
      if (peerCreationRef.current === creation) peerCreationRef.current = null;
    }
  }, [clearCallTimeout, cleanupCall, loadWebRTC, sendSignal, updateCall]);

  const answerOffer = useCallback(async (description) => {
    const current = callRef.current;
    if (!current || current.role !== 'callee' || !acceptingRef.current) return;

    const peer = peerConnectionRef.current ||
      await createPeerConnection(current.mediaType);
    const webRTC = await loadWebRTC();
    await peer.setRemoteDescription(
      new webRTC.RTCSessionDescription(description)
    );
    await addPendingCandidates(peer);
    const answer = await peer.createAnswer();
    await peer.setLocalDescription(answer);
    await sendSignal({ type: 'answer', description: peer.localDescription });
  }, [addPendingCandidates, createPeerConnection, loadWebRTC, sendSignal]);

  const handleSignal = useCallback(async (signal) => {
    if (
      !signal ||
      signal.from === currentUserId ||
      signal.from !== peerUserId ||
      typeof signal.callId !== 'string'
    ) {
      return;
    }

    const current = callRef.current;
    if (signal.type === 'invite') {
      if (current) return;
      updateCall({
        id: signal.callId,
        role: 'callee',
        mediaType: signal.mediaType === 'video' ? 'video' : 'audio',
        phase: 'incoming',
      });
      timeoutRef.current = setTimeout(cleanupCall, 45000);
      return;
    }

    if (!current || signal.callId !== current.id) return;

    if (signal.type === 'offer' && current.role === 'callee') {
      pendingOfferRef.current = signal.description;
      if (acceptingRef.current) await answerOffer(signal.description);
    } else if (signal.type === 'answer' && current.role === 'caller') {
      const peer = peerConnectionRef.current;
      if (!peer) return;
      const webRTC = await loadWebRTC();
      await peer.setRemoteDescription(
        new webRTC.RTCSessionDescription(signal.description)
      );
      await addPendingCandidates(peer);
    } else if (signal.type === 'candidate' && signal.candidate) {
      const peer = peerConnectionRef.current;
      if (!peer?.remoteDescription) {
        pendingCandidatesRef.current.push(signal.candidate);
      } else {
        const webRTC = await loadWebRTC();
        await peer.addIceCandidate(
          new webRTC.RTCIceCandidate(signal.candidate)
        );
      }
    } else if (signal.type === 'decline' || signal.type === 'hangup') {
      cleanupCall();
    }
  }, [
    addPendingCandidates,
    answerOffer,
    cleanupCall,
    currentUserId,
    loadWebRTC,
    peerUserId,
    updateCall,
  ]);

  useEffect(() => {
    signalHandlerRef.current = handleSignal;
  }, [handleSignal]);

  useEffect(() => {
    if (!enabled || !conversationId || !currentUserId || !peerUserId) {
      return undefined;
    }

    let active = true;
    const channel = supabase.channel(`call:${conversationId}`, {
      config: { private: true, broadcast: { self: false } },
    });
    channelRef.current = channel;

    channel
      .on('broadcast', { event: 'signal' }, ({ payload }) => {
        signalHandlerRef.current?.(payload).catch((error) => {
          console.warn('Could not handle call signal:', error.message);
        });
      })
      .subscribe((status) => {
        if (!active) return;
        setChannelReady(status === 'SUBSCRIBED');
      });

    return () => {
      active = false;
      setChannelReady(false);
      if (channelRef.current === channel) channelRef.current = null;
      supabase.removeChannel(channel);
      cleanupCall();
    };
  }, [
    cleanupCall,
    conversationId,
    currentUserId,
    enabled,
    peerUserId,
  ]);

  const startCall = useCallback(async (mediaType) => {
    if (!channelReady || callRef.current) {
      throw new Error('Wait for the secure chat connection before calling.');
    }

    const callId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setCallError('');
    updateCall({
      id: callId,
      role: 'caller',
      mediaType,
      phase: 'calling',
    });
    timeoutRef.current = setTimeout(cleanupCall, 45000);

    try {
      await loadWebRTC();
      const peer = await createPeerConnection(mediaType);
      if (callRef.current?.id !== callId) return;
      await sendSignal({ type: 'invite', mediaType });
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      await sendSignal({ type: 'offer', description: peer.localDescription });
    } catch (error) {
      cleanupCall();
      throw error;
    }
  }, [
    channelReady,
    cleanupCall,
    createPeerConnection,
    loadWebRTC,
    sendSignal,
    updateCall,
  ]);

  const answerCall = useCallback(async () => {
    if (callRef.current?.phase !== 'incoming') return;
    acceptingRef.current = true;
    const current = callRef.current;
    updateCall({ ...current, phase: 'connecting' });
    timeoutRef.current = setTimeout(cleanupCall, 45000);

    try {
      await loadWebRTC();
      await createPeerConnection(current.mediaType);
      if (pendingOfferRef.current) {
        await answerOffer(pendingOfferRef.current);
      }
    } catch (error) {
      cleanupCall();
      throw error;
    }
  }, [
    answerOffer,
    cleanupCall,
    createPeerConnection,
    loadWebRTC,
    updateCall,
  ]);

  const declineCall = useCallback(async () => {
    if (callRef.current?.role !== 'callee') return;
    try {
      await sendSignal({ type: 'decline' });
    } finally {
      cleanupCall();
    }
  }, [cleanupCall, sendSignal]);

  const hangUp = useCallback(async () => {
    if (!callRef.current) return;
    try {
      await sendSignal({ type: 'hangup' });
    } finally {
      cleanupCall();
    }
  }, [cleanupCall, sendSignal]);

  const toggleMicrophone = useCallback(() => {
    const track = localStreamRef.current?.getAudioTracks()[0];
    if (track) track.enabled = !track.enabled;
    return track?.enabled ?? false;
  }, []);

  const toggleCamera = useCallback(() => {
    const track = localStreamRef.current?.getVideoTracks()[0];
    if (track) track.enabled = !track.enabled;
    return track?.enabled ?? false;
  }, []);

  return {
    call,
    channelReady,
    localStream,
    remoteStream,
    callError,
    rtcView,
    startCall,
    answerCall,
    declineCall,
    hangUp,
    toggleMicrophone,
    toggleCamera,
  };
}
