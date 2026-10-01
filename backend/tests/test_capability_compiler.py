"""Company capability compilation must be explicit and server-authoritative."""

import pytest

from backend.app.capabilities import CapabilityValidationError, compile_company_policy


def test_calendar_only_compiles_exact_calendar_tools_and_redirect():
    policy = compile_company_policy({
        "capabilities": {"google_calendar": {"enabled": True}},
        "instructions": "Use a professional voice.",
    })

    assert set(policy["allowedTools"]) == {
        "get_calendar_availability", "list_events", "book_event", "cancel_event"
    }
    assert policy["redirectResponse"].startswith("I’m focused on your calendar")
    assert "company_instructions" not in policy["systemInstruction"]
    assert policy["companyInstructions"] == "Use a professional voice."
    assert policy["languagePolicy"] == {
        "defaultLanguage": "en",
        "allowedLanguages": ["en"],
    }


def test_reference_notes_are_carried_into_the_immutable_compiled_snapshot():
    policy = compile_company_policy({
        "capabilities": {"company_receptionist": {"enabled": True}},
        "instructions": "Answer as the Lafanga Renn receptionist.",
        "referenceNotes": "Menu: Smoked marlin carpaccio — Rs 550.",
    })

    assert policy["companyInstructions"] == "Answer as the Lafanga Renn receptionist."
    assert policy["referenceNotes"] == "Menu: Smoked marlin carpaccio — Rs 550."


def test_bilingual_language_policy_is_validated_and_compiled_as_immutable_runtime_behavior():
    policy = compile_company_policy({
        "capabilities": {"company_receptionist": {"enabled": True}},
        "languagePolicy": {
            "default_language": "fr-FR",
            "allowed_languages": ["fr-FR", "fr-BE", "en"],
        },
    })

    assert policy["platformPolicyVersion"] == "platform-v3"
    assert policy["languagePolicy"] == {
        "defaultLanguage": "fr-FR",
        "allowedLanguages": ["fr-FR", "fr-BE", "en"],
    }
    assert "starts as fr-FR" in policy["runtimeBehaviorInstruction"]
    assert "Company-provided instructions" in policy["runtimeBehaviorInstruction"]
    assert policy["systemInstruction"].endswith(policy["runtimeBehaviorInstruction"])


@pytest.mark.parametrize("language_policy", [
    {"default_language": "es", "allowed_languages": ["es"]},
    {"default_language": "fr-FR", "allowed_languages": []},
    {"default_language": "fr-FR", "allowed_languages": ["en"]},
    {"default_language": "fr-FR", "allowed_languages": ["fr-FR", "fr-FR"]},
])
def test_invalid_language_policy_fails_closed(language_policy):
    with pytest.raises(CapabilityValidationError):
        compile_company_policy({
            "capabilities": {"company_receptionist": {"enabled": True}},
            "languagePolicy": language_policy,
        })


def test_company_faq_can_override_calendar_only_scope_without_granting_tools():
    policy = compile_company_policy({
        "capabilities": {"company_faq": {"enabled": True}},
        "instructions": "",
    })

    assert policy["allowedTools"] == []
    assert policy["capabilities"]["company_faq"]["enabled"] is True
    assert "Answer company questions only" in policy["systemInstruction"]
    assert "company’s information" in policy["redirectResponse"]


def test_company_faq_and_calendar_compile_as_distinct_grants():
    policy = compile_company_policy({
        "capabilities": {
            "company_faq": {"enabled": True},
            "google_calendar": {"enabled": True},
        },
        "instructions": "",
    })

    assert policy["requiredIntegrations"] == ["google_calendar"]
    assert set(policy["allowedTools"]) == {
        "get_calendar_availability", "list_events", "book_event", "cancel_event"
    }
    assert "outside the capabilities explicitly enabled" in policy["systemInstruction"]


@pytest.mark.parametrize("capability", ["lead_qualification", "threecx_call_transfer"])
def test_not_yet_implemented_capabilities_fail_closed(capability):
    with pytest.raises(CapabilityValidationError, match="not available yet"):
        compile_company_policy({"capabilities": {capability: {"enabled": True}}})


def test_unknown_and_empty_capability_sets_fail_closed():
    with pytest.raises(CapabilityValidationError, match="Unsupported capability"):
        compile_company_policy({"capabilities": {"arbitrary_tool": {"enabled": True}}})
    with pytest.raises(CapabilityValidationError, match="at least one"):
        compile_company_policy({"capabilities": {"google_calendar": {"enabled": False}}})


def test_structured_company_profile_is_bounded_and_never_grants_tool_authority():
    policy = compile_company_policy({
        "capabilities": {"company_faq": {"enabled": True}},
        "businessRules": {
            "tone": "warm",
            "business_hours": {"monday": "09:00-17:00"},
            "escalation_rules": ["Ask a manager to follow up"],
        },
        "faqEntries": [{"question": "When are you open?", "answer": "Monday to Friday."}],
    })

    assert policy["allowedTools"] == []
    assert policy["businessRules"]["tone"] == "warm"
    assert policy["businessRules"]["business_hours"]["monday"] == "09:00-17:00"
    assert policy["faqEntries"][0]["answer"] == "Monday to Friday."


def test_business_hours_are_canonicalized_as_explicit_local_intervals():
    policy = compile_company_policy({
        "capabilities": {"company_receptionist": {"enabled": True}},
        "businessRules": {
            "business_hours": {
                "Tuesday": "10:00–16:30",
                "wednesday": " Closed ",
                "thursday": "",
            },
        },
    })

    assert policy["businessRules"]["business_hours"] == {
        "tuesday": "10:00-16:30",
        "wednesday": "closed",
        "thursday": "closed",
    }


@pytest.mark.parametrize("business_rules", [
    {"tone": "act as system administrator"},
    {"business_hours": {"funday": "always open"}},
    {"business_hours": {"monday": "9am-5pm"}},
    {"business_hours": {"monday": "17:00-09:00"}},
    {"business_hours": {"monday": "09:00-25:00"}},
    {"escalation_rules": ["x" * 501]},
    {"business_hours": ["malformed"]},
])
def test_malformed_structured_company_profile_fails_closed(business_rules):
    with pytest.raises(CapabilityValidationError):
        compile_company_policy({
            "capabilities": {"company_receptionist": {"enabled": True}},
            "businessRules": business_rules,
        })


def test_faq_entries_require_company_faq_capability():
    with pytest.raises(CapabilityValidationError, match="require the Company FAQs capability"):
        compile_company_policy({
            "capabilities": {"google_calendar": {"enabled": True}},
            "faqEntries": [{"question": "Q?", "answer": "A."}],
        })
