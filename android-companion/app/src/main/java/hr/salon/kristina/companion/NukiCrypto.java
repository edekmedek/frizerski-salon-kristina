package hr.salon.kristina.companion;

import com.goterl.lazysodium.SodiumAndroid;

import java.security.GeneralSecurityException;
import java.security.SecureRandom;
import java.util.Arrays;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

/** Exact NaCl primitives required by section 4 of Nuki Bluetooth API 2.3.1. */
public final class NukiCrypto {
    private final SodiumAndroid sodium = new SodiumAndroid();
    private final SecureRandom random = new SecureRandom();

    public KeyPair generateKeyPair() {
        byte[] privateKey = random(32);
        byte[] publicKey = new byte[32];
        if (sodium.crypto_scalarmult_base(publicKey, privateKey) != 0) {
            throw new IllegalStateException("Could not generate Curve25519 public key");
        }
        return new KeyPair(privateKey, publicKey);
    }

    public byte[] sharedSecret(byte[] privateKey, byte[] peerPublicKey) {
        byte[] sharedKey = new byte[32];
        // crypto_box_beforenm is NaCl's exact dh1 + kdf1 composition:
        // Curve25519 followed by HSalsa20 with the all-zero input and standard sigma.
        if (sodium.crypto_box_beforenm(sharedKey, peerPublicKey, privateKey) != 0) {
            throw new IllegalStateException("Curve25519/HSalsa20 key derivation failed");
        }
        return sharedKey;
    }

    public byte[] authenticate(byte[] key, byte[] data) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(key, "HmacSHA256"));
            return mac.doFinal(data);
        } catch (GeneralSecurityException error) {
            throw new IllegalStateException("HMAC-SHA256 unavailable", error);
        }
    }

    public byte[] encrypt(long authorizationId, int command, byte[] payload, byte[] key) {
        byte[] nonce = random(24);
        byte[] plaintext = NukiProtocol.encryptedPlaintext(authorizationId, command, payload);
        byte[] ciphertext = new byte[plaintext.length + 16];
        if (sodium.crypto_secretbox_easy(ciphertext, plaintext, plaintext.length, nonce, key) != 0) {
            throw new IllegalStateException("Nuki encryption failed");
        }
        return NukiProtocol.concat(nonce, NukiProtocol.le32(authorizationId),
                NukiProtocol.le16(ciphertext.length), ciphertext);
    }

    public NukiProtocol.ParsedPlain decrypt(byte[] message, long authorizationId, byte[] key) {
        if (message.length < 48 || NukiProtocol.u32(message, 24) != authorizationId) {
            throw new IllegalArgumentException("Invalid encrypted Nuki header");
        }
        int encryptedLength = NukiProtocol.u16(message, 28);
        if (message.length != 30 + encryptedLength || encryptedLength < 24) {
            throw new IllegalArgumentException("Invalid encrypted Nuki length");
        }
        byte[] plaintext = new byte[encryptedLength - 16];
        byte[] ciphertext = Arrays.copyOfRange(message, 30, message.length);
        byte[] nonce = Arrays.copyOfRange(message, 0, 24);
        if (sodium.crypto_secretbox_open_easy(
                plaintext, ciphertext, ciphertext.length, nonce, key) != 0) {
            throw new IllegalArgumentException("Nuki authentication/decryption failed");
        }
        if (NukiProtocol.u32(plaintext, 0) != authorizationId) {
            throw new IllegalArgumentException("Authorization ID mismatch in plaintext");
        }
        if (NukiProtocol.crc(Arrays.copyOf(plaintext, plaintext.length - 2))
                != NukiProtocol.u16(plaintext, plaintext.length - 2)) {
            throw new IllegalArgumentException("Invalid encrypted Nuki CRC");
        }
        return new NukiProtocol.ParsedPlain(NukiProtocol.u16(plaintext, 4),
                Arrays.copyOfRange(plaintext, 6, plaintext.length - 2));
    }

    public byte[] random(int length) {
        byte[] value = new byte[length];
        random.nextBytes(value);
        return value;
    }

    public static final class KeyPair {
        public final byte[] privateKey;
        public final byte[] publicKey;

        KeyPair(byte[] privateKey, byte[] publicKey) {
            this.privateKey = privateKey;
            this.publicKey = publicKey;
        }
    }
}
