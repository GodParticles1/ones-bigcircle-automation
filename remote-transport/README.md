# Remote transport client

P4g signed provider client for `CLOUDFLARE_WORKER_DO_R2_V1`.

Production:
- HTTPS only;
- role-specific secret file supplied at runtime;
- no Cloudflare account API token on the endpoint;
- no Browser/Relay credentials.

Commands:

```text
python remote-transport/client.py --base-url https://... --spool-root ... --role bigcircle-control --secret-file ... push-one --cleanup
python remote-transport/client.py --base-url https://... --spool-root ... --role windows-agent --secret-file ... pull-one
```

`--allow-http-loopback-test` exists only for local integration tests and accepts only `localhost` / `127.0.0.1`.
