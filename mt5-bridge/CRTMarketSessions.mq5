#property strict
#property version   "1.0"
#property description "Publishes broker quote and trade sessions for CRT Terminal. Read-only; sends no orders."

input int RefreshSeconds = 2;

string SessionFileName()
{
   long login = AccountInfoInteger(ACCOUNT_LOGIN);
   return "CRTMarketSessions_" + IntegerToString(login) + ".tsv";
}

string SafeField(string value)
{
   StringReplace(value, "\t", "_");
   StringReplace(value, "\r", " ");
   StringReplace(value, "\n", " ");
   return value;
}

bool WriteSessionRows(const int handle, const string symbol, const int day,
                      const bool quoteSession)
{
   for(uint index = 0; index <= 32; index++)
   {
      datetime from = 0;
      datetime to = 0;
      bool found = false;
      if(quoteSession)
         found = SymbolInfoSessionQuote(symbol, (ENUM_DAY_OF_WEEK)day, index, from, to);
      else
         found = SymbolInfoSessionTrade(symbol, (ENUM_DAY_OF_WEEK)day, index, from, to);
      if(!found)
         return true;
      if(index == 32)
         return false;

      long start = ((long)from % 86400 + 86400) % 86400;
      long finish = ((long)to % 86400 + 86400) % 86400;
      string tag = quoteSession ? "Q" : "T";
      FileWriteString(handle, "SESSION\t" + symbol + "\t" + IntegerToString(day) + "\t" + tag
                      + "\t" + IntegerToString(start) + "\t" + IntegerToString(finish) + "\r\n");
   }
   return false;
}

void WriteSymbolRows(const int handle, const string symbol)
{
   if(StringLen(symbol) == 0 || StringFind(symbol, "\t") >= 0 || StringFind(symbol, "\r") >= 0 || StringFind(symbol, "\n") >= 0)
      return;

   bool complete = true;
   for(int day = 0; day < 7; day++)
   {
      if(!WriteSessionRows(handle, symbol, day, true))
         complete = false;
      if(!WriteSessionRows(handle, symbol, day, false))
         complete = false;
   }
   if(complete)
      FileWriteString(handle, "COMPLETE\t" + symbol + "\r\n");
}

void PublishSessions()
{
   datetime serverTime = TimeTradeServer();
   if(serverTime <= 0)
      return;

   MqlDateTime brokerClock;
   if(!TimeToStruct(serverTime, brokerClock))
      return;

   int handle = FileOpen(SessionFileName(), FILE_WRITE | FILE_TXT | FILE_ANSI | FILE_COMMON | FILE_SHARE_READ);
   if(handle == INVALID_HANDLE)
      return;

   string server = SafeField(AccountInfoString(ACCOUNT_SERVER));
   long secondOfDay = brokerClock.hour * 3600 + brokerClock.min * 60 + brokerClock.sec;
   FileWriteString(handle, "CRT1\t" + IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN)) + "\t" + server
                   + "\t" + IntegerToString(brokerClock.day_of_week) + "\t" + IntegerToString(secondOfDay)
                   + "\t" + IntegerToString((long)TimeLocal()) + "\r\n");

   int total = SymbolsTotal(true);
   bool chartSymbolWritten = false;
   for(int index = 0; index < total; index++)
   {
      string symbol = SymbolName(index, true);
      if(symbol == _Symbol)
         chartSymbolWritten = true;
      WriteSymbolRows(handle, symbol);
   }
   if(!chartSymbolWritten)
      WriteSymbolRows(handle, _Symbol);

   // The bridge accepts only complete snapshots, so an interrupted write is ignored.
   FileWriteString(handle, "END\r\n");
   FileFlush(handle);
   FileClose(handle);
}

int OnInit()
{
   int interval = (int)MathMax(1, MathMin(30, RefreshSeconds));
   EventSetTimer(interval);
   PublishSessions();
   return INIT_SUCCEEDED;
}

void OnTimer()
{
   PublishSessions();
}

void OnDeinit(const int reason)
{
   EventKillTimer();
}
