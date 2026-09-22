import json
from pathlib import Path


def test_credential_kms_stack_has_rotation_retention_and_scoped_runtime_policy():
    template_path = Path(__file__).resolve().parents[2] / "infra" / "aws" / "credential-kms.template.json"
    template = json.loads(template_path.read_text(encoding="utf-8"))
    assert "CredentialBrokerRoleArn" in template["Parameters"]
    assert "CredentialRuntimeRoleArn" not in template["Parameters"]
    key = template["Resources"]["CredentialKey"]
    properties = key["Properties"]
    assert key["DeletionPolicy"] == "Retain"
    assert properties["EnableKeyRotation"] is True
    assert properties["PendingWindowInDays"] >= 30

    statements = properties["KeyPolicy"]["Statement"]
    runtime = next(item for item in statements if item["Sid"] == "AllowDedicatedCredentialBrokerCryptographicOperations")
    assert runtime["Principal"]["AWS"] == {"Ref": "CredentialBrokerRoleArn"}
    assert set(runtime["Action"]) == {"kms:Decrypt", "kms:GenerateDataKey"}
    assert runtime["Condition"]["ForAllValues:StringEquals"]["kms:EncryptionContextKeys"] == [
        "company_id", "provider", "field", "version"
    ]
    assert "kms:EncryptionContext:provider" in runtime["Condition"]["StringEquals"]
    assert "kms:EncryptionContext:field" in runtime["Condition"]["StringEquals"]
