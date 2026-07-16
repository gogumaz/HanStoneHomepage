# Installation

이 저장소는 하네스 설정만 제공합니다. 프로젝트 산출물이나 개인 자료는 포함하지 않습니다.

Windows:

```powershell
powershell -ExecutionPolicy Bypass -File .\install-harness.ps1 -TargetPath C:\Work\my-project
```

macOS/Linux:

```sh
sh ./install-harness.sh --target ~/Projects/my-project
```

대상에 기존 `.claude`, `CLAUDE.md`, `distribution`이 있으면 설치기는 중단합니다. 백업 후 교체하려면 `-Force` 또는 `--force`를 사용합니다.
