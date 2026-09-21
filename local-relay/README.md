# Local Relay

Windows-local loopback queue for a browser executor.

Current capabilities: `RELAY_PING` and `ONES_INVENTORY_READ` only.

Start:

```powershell
.\start.ps1
```

Stop:

```powershell
.\stop.ps1
```

The relay stores its generated local token and SQLite state under `data/`; that directory is gitignored. It must never store browser Cookie/Authorization/password material.
