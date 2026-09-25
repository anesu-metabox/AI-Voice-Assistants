import { NextResponse } from "next/server";
import {
  initialMockUser,
  initialMockCompanyProfile,
  initialMockAssistantConfig,
  initialMockAssistantVersions,
  initialMockCalls,
  initialMock3cxConfig,
  initialMockGoogleCalendar,
  initialMockTasks,
  MockCompanyProfile,
  MockAssistantConfig,
} from "./mockData";

class MockDataStore {
  user = { ...initialMockUser };
  companyProfile: MockCompanyProfile = { ...initialMockCompanyProfile };
  assistantConfig: MockAssistantConfig = { ...initialMockAssistantConfig };
  assistantVersions = [...initialMockAssistantVersions];
  calls = [...initialMockCalls];
  threecxConfig = { ...initialMock3cxConfig };
  googleCalendar = { ...initialMockGoogleCalendar };
  tasks = [...initialMockTasks];

  reset() {
    this.user = { ...initialMockUser };
    this.companyProfile = { ...initialMockCompanyProfile };
    this.assistantConfig = { ...initialMockAssistantConfig };
    this.assistantVersions = [...initialMockAssistantVersions];
    this.calls = [...initialMockCalls];
    this.threecxConfig = { ...initialMock3cxConfig };
    this.googleCalendar = { ...initialMockGoogleCalendar };
    this.tasks = [...initialMockTasks];
  }
}

// Global in-memory singleton across hot-reloads during dev
const globalStore = (globalThis as unknown as { __mockStore?: MockDataStore });
if (!globalStore.__mockStore) {
  globalStore.__mockStore = new MockDataStore();
}

export const mockStore = globalStore.__mockStore;

export async function handleMockAuth(request: Request, pathParts: string[]): Promise<Response> {
  const path = pathParts.join("/");

  if (path === "get-session" || path === "session") {
    return NextResponse.json({
      user: mockStore.user,
      session: {
        id: "mock-session-dev-01",
        userId: mockStore.user.id,
        createdAt: Date.now(),
        user: mockStore.user,
      },
    });
  }

  if (path.startsWith("sign-in") || path.startsWith("sign-up")) {
    return NextResponse.json({
      success: true,
      user: mockStore.user,
      session: {
        id: "mock-session-dev-01",
        userId: mockStore.user.id,
        createdAt: Date.now(),
        user: mockStore.user,
      },
      url: "/",
    });
  }

  if (path === "sign-out") {
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({
    user: mockStore.user,
    session: {
      id: "mock-session-dev-01",
      userId: mockStore.user.id,
      user: mockStore.user,
    },
  });
}

export async function handleMockProxy(request: Request, backendPath: string): Promise<Response> {
  const method = request.method.toUpperCase();
  const cleanPath = backendPath.split("?")[0].replace(/\/+$/, "");

  // Company Profile
  if (cleanPath === "/company-profile") {
    if (method === "GET") {
      return NextResponse.json({
        status: "success",
        data: mockStore.companyProfile,
      });
    }
    if (method === "POST" || method === "PUT") {
      try {
        const body = await request.json();
        mockStore.companyProfile = {
          ...mockStore.companyProfile,
          ...body,
          version: (mockStore.companyProfile.version || 1) + 1,
          updated_at: new Date().toISOString(),
        };
        return NextResponse.json({
          status: "success",
          data: mockStore.companyProfile,
        });
      } catch {
        return NextResponse.json({ status: "success", data: mockStore.companyProfile });
      }
    }
  }

  // Assistant Config
  if (cleanPath === "/assistant-config") {
    if (method === "GET") {
      return NextResponse.json({
        status: "success",
        data: mockStore.assistantConfig,
      });
    }
    if (method === "POST" || method === "PUT") {
      try {
        const body = await request.json();
        mockStore.assistantConfig = {
          ...mockStore.assistantConfig,
          ...body,
          version: mockStore.assistantConfig.version + 1,
          updated_at: new Date().toISOString(),
        };
        return NextResponse.json({
          status: "success",
          data: mockStore.assistantConfig,
        });
      } catch {
        return NextResponse.json({ status: "success", data: mockStore.assistantConfig });
      }
    }
  }

  // Assistant Config Validate
  if (cleanPath === "/assistant-config/validate") {
    return NextResponse.json({
      status: "success",
      valid: true,
      errors: [],
    });
  }

  // Assistant Config Versions
  if (cleanPath === "/assistant-config/versions") {
    return NextResponse.json({
      status: "success",
      data: mockStore.assistantVersions,
    });
  }

  // Assistant Config Publish
  if (cleanPath === "/assistant-config/publish") {
    mockStore.assistantConfig.is_deployed = true;
    return NextResponse.json({
      status: "success",
      version: mockStore.assistantConfig.version,
    });
  }

  // Assistant Config Rollback
  if (cleanPath === "/assistant-config/rollback") {
    return NextResponse.json({
      status: "success",
      message: "Rolled back assistant configuration.",
    });
  }

  // Assistant Config Runtime
  if (cleanPath === "/assistant-config/runtime") {
    return NextResponse.json({
      status: "success",
      data: mockStore.assistantConfig,
    });
  }

  // 3CX Integration
  if (cleanPath === "/integrations/3cx" || cleanPath === "/api/integrations/3cx") {
    if (method === "GET") {
      return NextResponse.json({
        status: "success",
        data: mockStore.threecxConfig,
      });
    }
    if (method === "PUT" || method === "POST") {
      try {
        const body = await request.json();
        mockStore.threecxConfig = {
          ...mockStore.threecxConfig,
          ...body,
          configured: true,
          status: "connected",
        };
      } catch {
        // ignore
      }
      return NextResponse.json({
        status: "success",
        data: mockStore.threecxConfig,
      });
    }
    if (method === "DELETE") {
      mockStore.threecxConfig.configured = false;
      mockStore.threecxConfig.status = "disconnected";
      return NextResponse.json({
        status: "success",
        disconnected: true,
      });
    }
  }

  // 3CX Calls List
  if (cleanPath === "/integrations/3cx/calls" || cleanPath === "/api/integrations/3cx/calls") {
    return NextResponse.json({
      status: "success",
      calls: mockStore.calls,
    });
  }

  // Google Calendar Auth Routes
  if (cleanPath.startsWith("/auth/google/")) {
    if (cleanPath === "/auth/google/status") {
      return NextResponse.json({
        connected: mockStore.googleCalendar.connected,
        email: mockStore.googleCalendar.email,
        calendar_id: mockStore.googleCalendar.calendar_id,
      });
    }
    if (cleanPath === "/auth/google/url") {
      return NextResponse.json({
        auth_url: "#mock-google-auth-success",
      });
    }
    if (cleanPath === "/auth/google/disconnect") {
      mockStore.googleCalendar.connected = false;
      return NextResponse.json({
        status: "success",
        disconnected: true,
      });
    }
  }

  // Tasks
  if (cleanPath.startsWith("/tasks") || cleanPath.startsWith("/api/tasks")) {
    return NextResponse.json({
      status: "success",
      tasks: mockStore.tasks,
      data: mockStore.tasks,
    });
  }

  // Bookings
  if (cleanPath.startsWith("/bookings") || cleanPath.startsWith("/api/bookings")) {
    return NextResponse.json({
      status: "success",
      data: [
        {
          id: "bk-1",
          customer_name: "Sarah Jenkins",
          service: "Brake Inspection",
          scheduled_at: new Date(Date.now() + 86400000).toISOString(),
          status: "confirmed",
        },
      ],
    });
  }

  // LiveKit / Gemini Tokens
  if (cleanPath.includes("livekit") || cleanPath.includes("gemini-token")) {
    return NextResponse.json({
      status: "success",
      token: "mock-sandbox-token-frontend-dev",
      server_url: "wss://mock.livekit.cloud",
      room_name: "mock-sandbox-room",
    });
  }

  // Default fallback for any other route
  return NextResponse.json({
    status: "success",
    mock: true,
    path: cleanPath,
    message: "Mock data provider responding for path: " + cleanPath,
  });
}

export function handleMockToolExecution(toolName: string, parameters: Record<string, unknown>) {
  if (toolName === "check_availability") {
    return {
      status: "success",
      result: {
        available_slots: [
          "Tomorrow at 9:00 AM",
          "Tomorrow at 11:30 AM",
          "Tomorrow at 2:00 PM",
          "Friday at 10:00 AM",
        ],
      },
    };
  }

  if (toolName === "book_appointment") {
    return {
      status: "success",
      result: {
        confirmation_code: "APX-88219",
        service: parameters.service || "Standard Inspection",
        slot: parameters.slot || "Tomorrow at 10:00 AM",
        status: "confirmed",
      },
    };
  }

  return {
    status: "success",
    result: {
      message: `Executed tool '${toolName}' successfully in mock mode.`,
      parameters,
    },
  };
}
