# AWS KMS setup for integration credentials

The isolated credential broker's envelope implementation uses a fresh AES-256
data key for every stored secret. AWS KMS wraps that data key; the database
stores only the wrapped key, AES-GCM ciphertext, nonce, and non-secret context.
The general backend calls typed broker operations and never receives decrypted
OAuth or 3CX credentials.

## Provisioning

The CloudFormation template at
[`infra/aws/credential-kms.template.json`](../infra/aws/credential-kms.template.json)
creates a symmetric KMS key with automatic annual rotation, a retained-key
deletion policy, and a dedicated alias. Supply the isolated broker workload
role ARN and a separate infrastructure key-administrator role ARN:

```powershell
aws cloudformation deploy `
  --template-file infra/aws/credential-kms.template.json `
  --stack-name voice-bot-credential-kms `
  --parameter-overrides `
    CredentialBrokerRoleArn=arn:aws:iam::123456789012:role/voice-bot-credential-broker `
    KeyAdminRoleArn=arn:aws:iam::123456789012:role/voice-bot-kms-admin
```

Use the application host's workload identity (for example, its task/instance
role or OIDC-assumed role); do not put static AWS access keys in application
configuration. Keep the key and credential broker in the same AWS region where
practical. Read the `CredentialKeyArn` stack output and configure the backend:

```text
APP_ENV=production
CREDENTIAL_KEY_PROVIDER=aws-kms
CREDENTIAL_KMS_KEY_ID=<CredentialKeyArn output>
AWS_REGION=<region containing the key>
CREDENTIAL_BROKER_URL=https://credential-broker.internal
CREDENTIAL_BROKER_SHARED_SECRET=<unique high-entropy backend/broker secret>
```

Only the credential-broker workload receives the KMS role and KMS key
configuration. The main backend receives the broker URL and shared request
authentication secret, but no KMS permissions. The shared secret is delivered
through the deployment secret manager and must not be committed or shared with
the browser or LiveKit worker.

The runtime key policy permits only `GenerateDataKey` and `Decrypt` for the
designated credential-broker role—not the general backend, Next.js, or LiveKit
worker—and requires exactly
the non-secret context keys `company_id`, `provider`, `field`, and `version`.
It limits providers to Google and 3CX and fields to the OAuth token/3CX API-key
fields currently used by the application. The key-administrator role cannot
decrypt data through this policy. Frontend, Next.js, and LiveKit worker roles
must not receive these cryptographic permissions.

The company identifier in KMS context is an audit/binding value, not a per-
tenant KMS authorization boundary. Tenant isolation still depends on verified
company identity, database RLS, and backend authorization. AWS records KMS
encryption context in audit logs; never put emails, names, tokens, or other
personal/secret values there.

Automatic KMS key rotation retains the ability to decrypt prior data keys.
Do not repoint the alias or schedule deletion as a routine rotation procedure:
deleting the customer-managed key makes existing credentials unrecoverable.
Test encryption and decryption with the actual workload identity before
migrating production OAuth columns or enabling credential writes.

## Validation gate

- Confirm the runtime role's trust policy is restricted to the backend host.
- Confirm no frontend or LiveKit worker identity can call `kms:Decrypt`.
- Run the credential-envelope tests and a deployment smoke test using the real
  workload identity; do not use real customer credentials for the smoke test.
- Confirm CloudTrail records the expected non-secret context and no credential
  values appear in app logs, traces, or error reports.
- Keep the Neon rollback branch and KMS key available through the rollback
  window.
