# 펌프 선정 웹앱

KMP 부스터 카타로그 기반 펌프 선정 앱

## 실행 방법

### 1. 엑셀 → JSON 변환 (최초 1회 또는 카타로그 변경 시)

```powershell
python scripts/excel_to_json.py
```

### 2. 웹 서버 실행

```powershell
cd public; python -m http.server 8080
```

브라우저에서 `http://localhost:8080` 접속

## 선정 조건

- **용도**: 급수(부스터), 소방(준비중)
- **유량**: m³/h, m³/min, LPM
- **양정**: m
- **펌프 타입**: 입형(CVF), 횡형(CMI/CMIA/SWPA)
- **전원**: 삼상, 단상
- **펌프 수량**: 1~5대

## 기술 스택

- Vanilla HTML/CSS/JS
- Network-first Service Worker (PWA)
- 엑셀 파싱: Python + pandas + openpyxl
