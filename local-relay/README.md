# Local Relay

Windows-local loopback queue for a browser executor.

Current capabilities: `RELAY_PING`, `ONES_INVENTORY_READ`, read-only `ONES_FIELD_READ`, and bounded `ONES_ROOT_CAUSE_WRITE`. The Browser Bridge exposes the write capability only when its explicit production write gate is enabled.

Start:

```powershell
.\start.ps1
```

Stop:

```powershell
.\stop.ps1
```

The relay stores its generated local token and SQLite state under `data/`; that directory is gitignored. It must never store browser Cookie/Authorization/password material.
