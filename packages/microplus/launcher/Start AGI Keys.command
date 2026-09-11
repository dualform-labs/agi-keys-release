#!/bin/zsh
set -u

script_dir="${0:A:h}"
"$script_dir/start-microplus.sh" start
result=$?

if [[ $result -eq 2 ]]; then
  if /usr/bin/osascript -e 'display dialog "Codex will restart to connect to AGI Keys. Save any unsent input, then choose Restart and Connect." with title "AGI Keys" buttons {"Cancel", "Restart and Connect"} default button "Restart and Connect" cancel button "Cancel"' >/dev/null 2>&1; then
    "$script_dir/start-microplus.sh" start --restart
    result=$?
  else
    print "Cancelled. Codex was not changed."
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
