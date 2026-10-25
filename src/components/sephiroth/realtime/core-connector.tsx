"use client";

import { useEffect } from "react";
import { io } from "socket.io-client";
import {
  CORE_SOCKET_URL,
  type ActivityEvent,
  type CoreEventPayload,
  type CoreInboundsPayload,
  type CoreSnapshot,
  type CoreTick,
} from "@/lib/realtime/core-types";
import { useCoreStore } from "@/lib/store/core-store";

/**
 * Mounted once inside the authenticated shell.
 * Bridges the core driver mini-service (socket.io :3003 via Caddy gateway)
 * into the zustand core store. Renders nothing.
 */
export function CoreConnector() {
  useEffect(() => {
    const socket = io(CORE_SOCKET_URL, {
      transports: ["websocket", "polling"],
      forceNew: true,
      reconnection: true,
      reconnectionDelay: 1500,
      timeout: 10000,
    });

    socket.on("connect", () => {
      useCoreStore.getState().setStatus("connecting");
    });

    socket.on("disconnect", () => {
      useCoreStore.getState().setStatus("offline");
    });

    socket.on("connect_error", () => {
      useCoreStore.getState().setStatus("offline");
    });

    socket.on("core:init", (snap: CoreSnapshot) => {
      useCoreStore.getState().applyInit(snap);
    });

    socket.on("core:tick", (tick: CoreTick) => {
      useCoreStore.getState().applyTick(tick);
    });

    socket.on("core:event", (payload: CoreEventPayload) => {
      if (payload?.event) useCoreStore.getState().applyEvent(payload.event as ActivityEvent);
    });

    socket.on("core:inbounds", (payload: CoreInboundsPayload) => {
      useCoreStore.getState().applyInbounds(payload);
    });

    return () => {
      socket.disconnect();
      useCoreStore.getState().setStatus("offline");
    };
  }, []);

  return null;
}
