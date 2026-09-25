export interface MockCompanyProfile {
  company_name: string;
  industry?: string;
  business_hours: string;
  primary_services: string;
  faq: string;
  onboarding_completed: boolean;
  version?: number;
  updated_at?: string;
}

export interface MockAssistantConfig {
  version: number;
  system_prompt: string;
  greeting: string;
  voice: string;
  language: string;
  model: string;
  capabilities: string[];
  is_deployed: boolean;
  updated_at: string;
}

export interface MockCallRecord {
  id: string;
  call_id: string;
  caller_number: string;
  caller_name: string;
  start_time: string;
  duration_seconds: number;
  status: "completed" | "missed" | "transferred" | "in-progress";
  transcript_summary: string;
  action_taken: string;
}

export const initialMockUser = {
  id: "dev-user-001",
  name: "Frontend Developer",
  email: "developer@metabox.local",
  role: "admin",
  image: null,
};

export const initialMockCompanyProfile: MockCompanyProfile = {
  company_name: "Apex Auto Care",
  industry: "Automotive Repair & Maintenance",
  business_hours: "Monday - Friday: 8:00 AM - 6:00 PM\nSaturday: 9:00 AM - 2:00 PM\nSunday: Closed",
  primary_services: "Oil Change ($49.99), Brake Inspection ($89.99), Tire Rotation ($35.00), Engine Diagnostics ($120.00), AC Recharge ($110.00)",
  faq: "Q: Do you accept walk-ins?\nA: Yes, walk-ins are welcome for quick services like oil changes and tire checks.\n\nQ: How long does a standard diagnostic take?\nA: Typically 45 to 60 minutes.\n\nQ: Do you provide loaner vehicles?\nA: Yes, for repairs exceeding 4 hours.",
  onboarding_completed: true,
  version: 1,
  updated_at: new Date().toISOString(),
};

export const initialMockAssistantConfig: MockAssistantConfig = {
  version: 1,
  system_prompt: "You are the helpful and professional AI receptionist for Apex Auto Care. Your role is to assist callers with service inquiries, check appointment availability, schedule bookings, and answer common questions about shop hours and pricing.",
  greeting: "Hello! Thank you for calling Apex Auto Care. My name is Alex, your virtual assistant. How can I help you today?",
  voice: "Puck",
  language: "en-US",
  model: "gemini-2.0-flash",
  capabilities: ["calendar_scheduling", "service_pricing_lookup", "faq_answering", "emergency_transfer"],
  is_deployed: true,
  updated_at: new Date().toISOString(),
};

export const initialMockAssistantVersions = [
  {
    version: 1,
    created_at: new Date(Date.now() - 86400000 * 2).toISOString(),
    system_prompt: initialMockAssistantConfig.system_prompt,
    greeting: initialMockAssistantConfig.greeting,
    voice: "Puck",
    capabilities: ["calendar_scheduling", "service_pricing_lookup", "faq_answering"],
    is_active: true,
    published_by: "Frontend Developer",
  },
  {
    version: 2,
    created_at: new Date().toISOString(),
    system_prompt: initialMockAssistantConfig.system_prompt + " Always confirm customer phone number before finishing.",
    greeting: "Hi there! Welcome to Apex Auto Care. How may I assist you?",
    voice: "Aoede",
    capabilities: ["calendar_scheduling", "service_pricing_lookup", "faq_answering", "emergency_transfer"],
    is_active: false,
    published_by: "Frontend Developer",
  },
];

export const initialMockCalls: MockCallRecord[] = [
  {
    id: "call-101",
    call_id: "3cx-call-88410",
    caller_number: "+1 (555) 234-5678",
    caller_name: "Sarah Jenkins",
    start_time: new Date(Date.now() - 1000 * 60 * 15).toISOString(),
    duration_seconds: 142,
    status: "completed",
    transcript_summary: "Customer requested a brake inspection and oil change for a 2021 Toyota RAV4. Booked for tomorrow at 10:00 AM.",
    action_taken: "Appointment Scheduled",
  },
  {
    id: "call-102",
    call_id: "3cx-call-88409",
    caller_number: "+1 (555) 987-6543",
    caller_name: "Michael Chen",
    start_time: new Date(Date.now() - 1000 * 60 * 65).toISOString(),
    duration_seconds: 88,
    status: "completed",
    transcript_summary: "Customer inquired about Saturday opening hours and diagnostic pricing.",
    action_taken: "Inquiry Answered",
  },
  {
    id: "call-103",
    call_id: "3cx-call-88408",
    caller_number: "+1 (555) 443-2211",
    caller_name: "David Miller",
    start_time: new Date(Date.now() - 1000 * 60 * 180).toISOString(),
    duration_seconds: 210,
    status: "transferred",
    transcript_summary: "Customer reported an active check engine light and smoking radiator. Requested immediate human technician.",
    action_taken: "Transferred to Service Bay Ext 104",
  },
  {
    id: "call-104",
    call_id: "3cx-call-88407",
    caller_number: "+1 (555) 321-7788",
    caller_name: "Emma Watson",
    start_time: new Date(Date.now() - 1000 * 60 * 360).toISOString(),
    duration_seconds: 45,
    status: "completed",
    transcript_summary: "Confirmed appointment reschedule from 2:00 PM to 4:30 PM.",
    action_taken: "Booking Rescheduled",
  },
];

export const initialMock3cxConfig = {
  configured: true,
  status: "connected",
  server_url: "https://apex-auto.3cx.cloud:5001",
  route_point_dn: "8000",
  service_principal_id: "sp-apex-dev-client",
  last_sync: new Date().toISOString(),
};

export const initialMockGoogleCalendar = {
  connected: true,
  email: "developer@metabox.local",
  calendar_id: "primary",
  last_synced: new Date().toISOString(),
};

export const initialMockTasks = [
  {
    id: "task-01",
    type: "booking_confirmation",
    title: "Confirm Brake Inspection for Sarah Jenkins",
    description: "Scheduled for Tomorrow at 10:00 AM (2021 Toyota RAV4)",
    status: "pending_dispatch",
    customer_phone: "+1 (555) 234-5678",
    created_at: new Date(Date.now() - 1000 * 60 * 14).toISOString(),
  },
  {
    id: "task-02",
    type: "reschedule_notification",
    title: "Send SMS Update to Emma Watson",
    description: "Rescheduled appointment to today at 4:30 PM",
    status: "completed",
    customer_phone: "+1 (555) 321-7788",
    created_at: new Date(Date.now() - 1000 * 60 * 350).toISOString(),
  },
];
