#!/bin/zsh
set -u

script_dir="${0:A:h}"
"$script_dir/start-microplus.sh" start
result=$?

if [[ $result -eq 2 ]]; then
  if /usr/bin/osascript -e 'display dialog "Codex Keysに接続するため、Codexを再起動します。未送信の入力を保存してから「再起動して接続」を押してください。" with title "Codex Keys" buttons {"キャンセル", "再起動して接続"} default button "再起動して接続" cancel button "キャンセル"' >/dev/null 2>&1; then
    "$script_dir/start-microplus.sh" start --restart
    result=$?
  else
    print "キャンセルしました。Codexは変更していません。"
    exit 0
  fi
elif [[ $result -eq 3 ]]; then
  print
  print "Codex is not running. The launcher did not start it because this command returned a preflight state."
  print "Run '$script_dir/start-microplus.sh' start in Terminal when you are ready."
elif [[ $result -eq 4 ]]; then
  print
  print "Multiple Codex processes were detected. Nothing was stopped or started."
  print "Close the duplicate manually, then rerun the launcher."
fi

if [[ -t 0 ]]; then
  print
  read "_?Press Return to close this window."
fi
exit $result
