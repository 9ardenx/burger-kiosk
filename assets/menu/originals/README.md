# 메뉴 사진 보관본

감자튀김의 배경을 편집하기 전, 공개 매장에 저장되어 있던 메뉴 사진 7개입니다. 파일명은 찾기 쉽도록 메뉴명으로 정리했고 JPEG 내용은 서버 보관본과 동일합니다. `manifest.json`에 메뉴 이름, 파일명, SHA-256 해시를 기록했습니다.

| 메뉴 | 사진 |
| --- | --- |
| 클래식버거 | [classic-burger.jpg](classic-burger.jpg) |
| 치킨버거 | [chicken-burger.jpg](chicken-burger.jpg) |
| 감자튀김 | [fries.jpg](fries.jpg) |
| 탄산음료 | [soda.jpg](soda.jpg) |
| 치킨너겟 | [chicken-nuggets.jpg](chicken-nuggets.jpg) |
| 버팔로윙 | [buffalo-wings.jpg](buffalo-wings.jpg) |
| 새우버거 | [shrimp-burger.jpg](shrimp-burger.jpg) |

관리자 업로드 기능은 사진을 가로·세로 중 긴 쪽 최대 720px의 JPEG로 변환한 뒤 서버에 저장합니다. 이 폴더는 그 서비스용 파일을 보관합니다. 조원 PC에 있는 업로드 전 고해상도 파일은 별도로 보관해야 합니다.

현재 키오스크는 데이터베이스의 사진 키로 서버 이미지를 불러옵니다. 이 폴더는 Git에서 이력을 보관하기 위한 복사본이며, 폴더에 파일을 추가하는 것만으로 매장 사진이 바뀌지는 않습니다. 새로 편집한 감자튀김 사진은 상위 폴더의 `fries-roomy-720x465.jpg`에 별도로 있습니다.
