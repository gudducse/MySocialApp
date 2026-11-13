import React, { useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

export default function DirectCallModal({
  call,
  peerName,
  localStream,
  remoteStream,
  RTCView,
  onAnswer,
  onDecline,
  onHangUp,
  onToggleMicrophone,
  onToggleCamera,
}) {
  const [microphoneEnabled, setMicrophoneEnabled] = useState(true);
  const [cameraEnabled, setCameraEnabled] = useState(true);
  if (!call) return null;

  const isIncoming = call.phase === 'incoming';
  const hasVideo = call.mediaType === 'video';
  const remoteUrl = remoteStream?.toURL?.();
  const localUrl = localStream?.toURL?.();
  const status = isIncoming
    ? `Incoming ${hasVideo ? 'video' : 'voice'} call`
    : call.phase === 'connected'
    ? 'Connected · Encrypted peer-to-peer'
    : call.phase === 'calling'
    ? 'Calling…'
    : 'Connecting securely…';

  const toggleMicrophone = () => {
    setMicrophoneEnabled(onToggleMicrophone());
  };

  const toggleCamera = () => {
    setCameraEnabled(onToggleCamera());
  };

  return (
    <Modal visible animationType="slide" onRequestClose={onHangUp}>
      <View style={styles.container}>
        {RTCView && hasVideo && remoteUrl ? (
          <RTCView
            streamURL={remoteUrl}
            style={StyleSheet.absoluteFill}
            objectFit="cover"
            zOrder={0}
          />
        ) : null}

        {RTCView && hasVideo && localUrl && call.phase === 'connected' ? (
          <RTCView
            streamURL={localUrl}
            style={styles.localVideo}
            objectFit="cover"
            mirror
            zOrder={1}
          />
        ) : null}

        <View style={styles.identity}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>
              {(peerName || 'U').charAt(0).toUpperCase()}
            </Text>
          </View>
          <Text style={styles.name} numberOfLines={1}>{peerName || 'User'}</Text>
          <Text style={styles.status}>{status}</Text>
          <View style={styles.encryptionBadge}>
            <Ionicons name="lock-closed" size={13} color="#AAB4C8" />
            <Text style={styles.encryptionText}>
              Peer-to-peer encrypted
            </Text>
          </View>
          {call.phase === 'calling' || call.phase === 'connecting' ? (
            <ActivityIndicator color="#FFFFFF" style={styles.loading} />
          ) : null}
        </View>

        {isIncoming ? (
          <View style={styles.incomingActions}>
            <CallButton
              label="Decline"
              icon="call"
              color="#E5484D"
              onPress={onDecline}
            />
            <CallButton
              label="Accept"
              icon={hasVideo ? 'videocam' : 'call'}
              color="#27AE60"
              onPress={onAnswer}
            />
          </View>
        ) : (
          <View style={styles.controls}>
            <CallButton
              label={microphoneEnabled ? 'Mute' : 'Unmute'}
              icon={microphoneEnabled ? 'mic' : 'mic-off'}
              color="#323944"
              onPress={toggleMicrophone}
            />
            {hasVideo ? (
              <CallButton
                label={cameraEnabled ? 'Camera' : 'Camera off'}
                icon={cameraEnabled ? 'videocam' : 'videocam-off'}
                color="#323944"
                onPress={toggleCamera}
              />
            ) : null}
            <CallButton
              label="End"
              icon="call"
              color="#E5484D"
              onPress={onHangUp}
            />
          </View>
        )}
      </View>
    </Modal>
  );
}

function CallButton({ label, icon, color, onPress }) {
  return (
    <TouchableOpacity
      style={styles.callButton}
      activeOpacity={0.8}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <View style={[styles.callButtonIcon, { backgroundColor: color }]}>
        <Ionicons name={icon} size={24} color="#FFFFFF" />
      </View>
      <Text style={styles.callButtonLabel}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#090D12',
    alignItems: 'center',
    justifyContent: 'center',
  },
  identity: {
    alignItems: 'center',
    maxWidth: '80%',
  },
  avatar: {
    width: 104,
    height: 104,
    borderRadius: 52,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#252D5B',
    marginBottom: 22,
  },
  avatarText: {
    color: '#FFFFFF',
    fontSize: 42,
    fontWeight: '700',
  },
  name: {
    color: '#FFFFFF',
    fontSize: 26,
    fontWeight: '700',
  },
  status: {
    color: '#B8C0CC',
    fontSize: 15,
    marginTop: 10,
  },
  encryptionBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 16,
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 18,
    backgroundColor: '#171D27',
  },
  encryptionText: {
    color: '#AAB4C8',
    fontSize: 12,
    fontWeight: '600',
  },
  loading: {
    marginTop: 24,
  },
  localVideo: {
    position: 'absolute',
    top: 58,
    right: 18,
    width: 108,
    height: 156,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#202630',
  },
  controls: {
    position: 'absolute',
    bottom: 60,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 24,
  },
  incomingActions: {
    position: 'absolute',
    bottom: 68,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 60,
  },
  callButton: {
    alignItems: 'center',
    minWidth: 62,
  },
  callButtonIcon: {
    width: 58,
    height: 58,
    borderRadius: 29,
    alignItems: 'center',
    justifyContent: 'center',
  },
  callButtonLabel: {
    color: '#FFFFFF',
    fontSize: 12,
    marginTop: 9,
  },
});
