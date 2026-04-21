import argparse
import requests

parser = argparse.ArgumentParser()
parser.add_argument("--user_id", required=True)
parser.add_argument("--param_value", required=True)
args = parser.parse_args()

url = f"https://www.botgc.co.uk/member.php?memberid={args.user_id}&requestType=ajax&ajaxaction=saveparamvalue"

headers = {
    "host": "www.botgc.co.uk",
    "sec-ch-ua-platform": "\"Windows\"",
    "x-requested-with": "XMLHttpRequest",
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36 Edg/145.0.0.0",
    "accept": "*/*",
    "sec-ch-ua": "\"Not:A-Brand\";v=\"99\", \"Microsoft Edge\";v=\"145\", \"Chromium\";v=\"145\"",
    "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
    "sec-ch-ua-mobile": "?0",
    "origin": "https://www.botgc.co.uk",
    "sec-fetch-site": "same-origin",
    "sec-fetch-mode": "cors",
    "sec-fetch-dest": "empty",
    "referer": f"https://www.botgc.co.uk/member.php?memberid={args.user_id}",
    "accept-encoding": "gzip, deflate, br, zstd",
    "accept-language": "en-US,en;q=0.9,en-GB;q=0.8",
    "priority": "u=1, i",
    "cookie": "cc_cookie_accept=cc_cookie_accept; PHPSESSID=03pr34nd0ce2r857llki4nt25d; ig_persist=83642%3B658edaa0dff8f4fe6b96c88c61dce3d00680584c79180495335a57aaf1bc98946dff07244067eaa7a7c7cb33aa5d0199f37774d4d97fe4e5c17e7096e6c2f590%3B127a3fa6c869cb1d811e6d177d1f51646465251b1e339f53bbb1984fa86716565ccf4a59f7cfeca2a1f0c05f83a742e8f48a39ebaf107336e3d757dd5c5bc6ff"
}

data = f"paramid=26&user_id={args.user_id}&param_value={args.param_value}"

response = requests.post(
    url,
    headers=headers,
    data=data,
    verify=False
)

print(response.status_code)
